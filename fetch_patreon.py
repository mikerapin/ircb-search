#!/usr/bin/env python3
"""Pull the Patreon-only episodes out of the IRCB Secret Feed.

The Secret Feed carries 742 items, but 442 of them are the public episodes served ad-free.
Those already reach the site from the Simplecast feed, so this keeps only what is genuinely
Patreon-only and writes it to data/patreon.json for scripts/build-data.mjs to merge.

Never writes the enclosure. Its URL embeds a per-patron signature
(/api/rss/u/<token>/e/<id>.mp3?sig=...) which would leak a private feed to anyone reading the
built site. Only <link>, which is the public patreon.com/ircbpodcast/posts/... page, ships.

Reads PATREON_RSS_URL from the environment, falling back to a gitignored .env.

    python fetch_patreon.py
"""

import json
import os
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from pathlib import Path

HERE = Path(__file__).parent
DATA = HERE / "data"
PUBLIC_RSS = "https://feeds.simplecast.com/U93zjuSN"

# Read-alongs where every episode is about one book, so the title and description never need
# to name it. Anything not listed here gets its comics from a rule below or from
# data/patreon-comics.json, and an episode with no comic is still a real episode.
#
# The flag says whether a number in the title is the comic's issue or volume. It is true for
# Saga of Saga alone: 'Saga of Saga #37' really is Saga #37. Everywhere else the number counts
# episodes of the read-along, so reading it as an issue invents a citation — 'Wic+Div
# Uncovered #11' is the eleventh episode, and it covers the final arc rather than issue 11.
SERIES_SUBJECT = [
    (r"saga of saga", "Saga", True),
    (r"giant days of our live", "Giant Days", False),
    (r"wic\+div uncovered", "The Wicked + The Divine", False),
    (r"read doom patrol", "Doom Patrol", False),
]

# The monthly Goodreads pick states its book in the title, and separates it with a colon when
# it is a book but a dash when it is a theme:
#   "September 2021 Goodreads Book of the Month: Black Widow Vol. 1: S.H.I.E.L.D.'s Most Wanted"
#   "July 2022 Goodreads Book of the Month - Sports Comics"
# The first names one comic. The second names a category the panel read around, so it has no
# single book and the description has to carry them instead.
GOODREADS = re.compile(r"goodreads book of the month\s*:\s*(.+)$", re.I)

POST_CREDITS = re.compile(r"post[\s\-]*credits?", re.I)
EPISODE_NO = re.compile(r"\bEpisode\s+(\d+)\b", re.I)
VOLUME = re.compile(r"\b(?:vol\.?|volume)\s*(\d+)", re.I)
ISSUE = re.compile(r"#\s*(\d+(?:\s*-\s*\d+)?)")
# "Book vs. Book 9 | Fante Bukowski vs The Untold Legend of Batman" names both books
VERSUS = re.compile(r"\s+vs\.?\s+", re.I)


def load_env():
    if os.environ.get("PATREON_RSS_URL"):
        return os.environ["PATREON_RSS_URL"]
    env = HERE / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                if k.strip() == "PATREON_RSS_URL" and v.strip():
                    return v.strip()
    sys.exit("PATREON_RSS_URL is not set. Put it in the environment or in a gitignored .env.")


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "ircb-search/1.0"})
    with urllib.request.urlopen(req) as resp:
        return resp.read()


def norm(text):
    return re.sub(r"[^a-z0-9]+", "", (text or "").lower())


def child(item, name):
    for c in item:
        if c.tag.split("}")[-1] == name:
            return c
    return None


def load_json(name, default):
    path = DATA / name
    return json.loads(path.read_text()) if path.exists() else default


def public_titles():
    """Normalised titles of every public episode, plus a number → title map for the old era."""
    tree = ET.fromstring(get(PUBLIC_RSS))
    titles, by_number = set(), {}
    for item in tree.iter("item"):
        title = item.findtext("title") or ""
        titles.add(norm(title))
        m = re.match(r"\s*Episode\s+(\d+)\s*\|", title)
        if m:
            by_number[int(m.group(1))] = title
    return titles, by_number


def parent_of(title, titles, by_number):
    """The public episode a post-credits segment belongs to, or None.

    Two shapes. Recent ones are 'Post Credits: <episode title>'. The 2023 run is
    'Episode 390: Post-Credits' against a public title of 'Episode 390 | Go Look At A Real
    Boob', so those match on the number rather than the words.
    """
    if not POST_CREDITS.search(title):
        return None
    stem = POST_CREDITS.sub("", title)
    stem = re.sub(r"^[\s:\-–—|]+|[\s:\-–—|]+$", "", stem)
    if norm(stem) in titles:
        return stem
    m = EPISODE_NO.search(stem)
    return by_number.get(int(m.group(1))) if m else None


def subject_comics(title):
    """Comics for a read-along, from its series subject plus whatever number the title states."""
    match = next(((s, n) for pat, s, n in SERIES_SUBJECT if re.search(pat, title, re.I)), None)
    if not match:
        return None
    subject, number_is_the_comic = match
    if not number_is_the_comic:
        return [subject]                  # the number counts episodes, so ignore it
    issue = ISSUE.search(title)
    if issue:
        return [f"{subject} #{re.sub(r'\s*-\s*', '-', issue.group(1))}"]
    volume = VOLUME.search(title)
    if volume:
        return [f"{subject} Vol. {volume.group(1)}"]
    return [subject]                      # an intro or a finale, still about the book


def goodreads_comics(title):
    """The month's pick, when the title names one. 'House of X / Powers of X' is two books."""
    m = GOODREADS.search(title)
    if not m:
        return None
    picks = [p.strip(" .") for p in m.group(1).split(" / ") if p.strip(" .")]
    return picks or None


def versus_comics(title):
    """'Book vs. Book 9 | Fante Bukowski vs The Untold Legend of Batman' -> both books."""
    if "|" not in title:
        return None
    tail = title.split("|", 1)[1].strip()
    parts = [p.strip(" .") for p in VERSUS.split(tail) if p.strip(" .")]
    return parts if len(parts) == 2 else None


def main():
    url = load_env()
    overrides = load_json("patreon-comics.json", {"posts": {}})
    excluded = load_json("patreon-no-comic.json", {"posts": {}, "seriesPatterns": []})
    skip_ids = set(excluded.get("posts", {}))
    skip_patterns = [s["pattern"] for s in excluded.get("seriesPatterns", [])]

    print("Fetching the public feed to tell mirrors apart...")
    titles, by_number = public_titles()
    print(f"  → {len(titles)} public episodes")

    print("Fetching the Secret Feed...")
    tree = ET.fromstring(get(url))
    items = list(tree.iter("item"))
    print(f"  → {len(items)} items")

    episodes, mirrors, no_comic = [], 0, 0
    for item in items:
        title = (item.findtext("title") or "").strip()
        if norm(title) in titles:
            mirrors += 1
            continue

        guid = (item.findtext("guid") or "").strip()
        parent = parent_of(title, titles, by_number)

        if guid in skip_ids or any(re.search(p, title, re.I) for p in skip_patterns):
            comics = []
        elif guid in overrides.get("posts", {}):
            comics = overrides["posts"][guid]["comics"]
        elif parent:
            comics = []                   # the segment links to its episode, it does not
        else:                             # inherit comics it never discussed
            comics = (subject_comics(title) or goodreads_comics(title)
                      or versus_comics(title) or [])
        if not comics and not parent:
            no_comic += 1

        image = child(item, "image")
        date = item.findtext("pubDate")
        duration = child(item, "duration")
        episodes.append({
            "guid": guid,
            "title": title,
            "date": parsedate_to_datetime(date).date().isoformat() if date else None,
            "durationSecs": int(duration.text) if duration is not None and
                            (duration.text or "").strip().isdigit() else None,
            "url": item.findtext("link"),
            "artwork": (image.get("href") or image.text) if image is not None else None,
            "summary": item.findtext("description"),
            "parentTitle": parent,
            "comics": comics,
        })

    episodes.sort(key=lambda e: (e["date"] or "", e["title"]), reverse=True)
    out = DATA / "patreon.json"
    out.write_text(json.dumps({"episodes": episodes}, ensure_ascii=False, indent=1))

    linked = sum(1 for e in episodes if e["parentTitle"])
    withc = sum(1 for e in episodes if e["comics"])
    print(f"  → {mirrors} mirrors of the public feed, skipped")
    print(f"  → {len(episodes)} Patreon-only episodes → {out}")
    print(f"     {withc} with comics, {linked} post-credits linked to their episode, "
          f"{no_comic} with neither")


if __name__ == "__main__":
    main()
