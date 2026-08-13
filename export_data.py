#!/usr/bin/env python3
"""
Export IRCB data from sshugars/ircb to JSON for the search UI.
Run this whenever the source data is updated.

Requirements: pip install pandas openpyxl
"""

import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

from panel_line import stated_people

try:
    import pandas as pd
except ImportError:
    sys.exit("Missing dependency: pip install pandas openpyxl")

COMIC_DENYLIST = {"comic books", "comics", "ircb", "i read comic books", "guest"}

DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(exist_ok=True)

COMICS_URL = "https://github.com/sshugars/ircb/raw/main/tables/public_feed_comics.xlsx"
EPISODES_URL = "https://github.com/sshugars/ircb/raw/main/tables/all_episodes.xlsx"
RSS_URL = "https://feeds.simplecast.com/U93zjuSN"

COMIC_COLS = ["comic", "show_id", "segment", "timestamp", "direct_url"]
EPISODE_COLS = ["show_id", "title", "date", "people", "keywords", "simplecast_url"]

_EPISODE_UUID_RE = re.compile(
    r"/episodes/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/audio/",
    re.I,
)


_ITUNES_NS = "http://www.itunes.com/dtds/podcast-1.0.dtd"


def build_rss_maps():
    """Return {url → {player_id, summary, enclosure_url, artwork_url, duration_secs}} from RSS."""
    print("Fetching RSS feed...")
    with urllib.request.urlopen(RSS_URL) as resp:
        rss_bytes = resp.read()
    tree = ET.fromstring(rss_bytes)
    rss = {}
    for item in tree.iter("item"):
        link_el = item.find("link")
        if link_el is None or not link_el.text:
            continue
        link = link_el.text.split("?")[0].rstrip("/")
        rec = {"player_id": None, "summary": None, "enclosure_url": None,
               "artwork_url": None, "duration_secs": None, "panel": [],
               # Carried so append_missing() can build a table row out of a feed item. The
               # guid is the same UUID the upstream table stores as show_id, which is what
               # keeps the key stable when the table catches up — see append_missing.
               "title": (item.findtext("title") or "").strip() or None,
               "date": item.findtext("pubDate"),
               "show_id": (item.findtext("guid") or "").strip() or None,
               "keywords": item.findtext(f"{{{_ITUNES_NS}}}keywords")}
        # The credits block lives in <description>, not itunes:summary. Panel and Guest are
        # the only roles that put someone on the episode — Producer, Post Production,
        # Prooflistener and Editor are crew, and the prooflistener in particular is a
        # panelist who was NOT on that week's show.
        desc_el = item.find("description")
        rec["panel"] = stated_people(
            (desc_el.text if desc_el is not None else None)
            or (item.findtext(f"{{{_ITUNES_NS}}}summary") or ""))
        enc_el = item.find("enclosure")
        if enc_el is not None:
            url = enc_el.get("url", "")
            rec["enclosure_url"] = url or None
            m = _EPISODE_UUID_RE.search(url)
            if m:
                rec["player_id"] = m.group(1)
        summary_el = item.find(f"{{{_ITUNES_NS}}}summary")
        if summary_el is not None and summary_el.text:
            rec["summary"] = summary_el.text.strip()
        img_el = item.find(f"{{{_ITUNES_NS}}}image")
        if img_el is not None:
            rec["artwork_url"] = img_el.get("href") or None
        dur_el = item.find(f"{{{_ITUNES_NS}}}duration")
        if dur_el is not None and dur_el.text:
            rec["duration_secs"] = _parse_duration(dur_el.text.strip())
        rss[link] = rec
    print(f"  → {len(rss)} RSS items mapped")
    return rss


def _parse_duration(s):
    """'1:02:33' or '3753' → seconds, else None."""
    try:
        parts = [int(p) for p in s.split(":")]
    except ValueError:
        return None
    if not parts:
        return None
    secs = 0
    for p in parts:
        secs = secs * 60 + p
    return secs


def export_comics():
    print("Fetching comics data from GitHub...")
    df = pd.read_excel(COMICS_URL, engine="openpyxl")
    df = df[[c for c in COMIC_COLS if c in df.columns]]
    df = df.dropna(subset=["comic"])
    df["comic"] = df["comic"].astype(str).str.strip()
    df = df[~df["comic"].str.lower().isin(COMIC_DENYLIST)]
    if "segment" in df.columns:
        df["segment"] = df["segment"].astype(str).str.strip().replace({"nan": None, "": None})
    out = DATA_DIR / "comics.json"
    df.to_json(out, orient="records", force_ascii=False)
    print(f"  → {len(df)} comic mentions → {out}")


def load_patreon_series():
    """Load the series-name → Patreon collection URL mapping from data/patreon-series.json."""
    path = DATA_DIR / "patreon-series.json"
    if not path.exists():
        return []
    with open(path) as f:
        return json.load(f)


def assign_patreon_url(title, patreon_series):
    """Return the Patreon collection URL for a title that matches a known series, else None."""
    if not title or not isinstance(title, str):
        return None
    for series in patreon_series:
        if series["pattern"] in title:
            return series["url"]
    return None


def append_missing(df, rss):
    """Add public episodes the upstream table has not caught up to yet.

    all_episodes.xlsx is regenerated by a weekly job in sshugars/ircb, and the site used to
    treat it as the only source of the episode list. So a week where that job is late — it
    last ran 2026-08-05, and Aug 12's episode was still absent on Aug 13 — left the newest
    episode missing from the site entirely, with no way to tell that from a quiet week.

    It also broke something less obvious: a post-credits segment names its parent by title, and
    with no row for the parent there is nothing to resolve against, so the segment shipped
    alone. `dropUnreleased` now holds those, but that hides an episode rather than showing it.

    The feed already has everything the card needs except comics, which are read from the
    episode notes rather than the feed and arrive when the table does. `show_id` is the RSS
    guid, which is the value the table itself uses, so the key does not change under the
    episode when the table catches up and the row stops coming from here.
    """
    have = {str(u).split("?")[0].rstrip("/") for u in df["simplecast_url"].dropna()}
    new = [{"show_id": r["show_id"], "title": r["title"], "date": r["date"],
            "people": None, "keywords": r["keywords"], "simplecast_url": link}
           for link, r in rss.items()
           if link not in have and r["show_id"] and r["title"]]
    if not new:
        return df
    for r in new:
        print(f"  + {r['title']} — in the feed, not yet in the table")
    return pd.concat([df, pd.DataFrame(new)], ignore_index=True)


def export_episodes():
    print("Fetching episodes data from GitHub...")
    df = pd.read_excel(EPISODES_URL, engine="openpyxl")
    df = df[[c for c in EPISODE_COLS if c in df.columns]]

    rss = build_rss_maps()
    df = append_missing(df, rss)

    def rss_field(url, field):
        if not url or isinstance(url, float):
            return None
        rec = rss.get(str(url).split("?")[0].rstrip("/"))
        return rec[field] if rec else None

    for field in ("player_id", "summary", "enclosure_url", "artwork_url", "duration_secs",
                  "panel"):
        df[field] = df["simplecast_url"].apply(lambda u, f=field: rss_field(u, f))
    matched = df["player_id"].notna().sum()
    print(f"  → {matched}/{len(df)} episodes matched to a Simplecast player ID")
    stated = df["panel"].apply(lambda p: bool(p) and len(p) > 0).sum()
    print(f"  → {stated} episodes state their panel in the description")

    # Assign Patreon collection URLs to spin-off episodes that have no Simplecast URL
    patreon_series = load_patreon_series()
    df["patreon_url"] = df.apply(
        lambda row: assign_patreon_url(row.get("title"), patreon_series)
        if (pd.isna(row.get("simplecast_url")) or not row.get("simplecast_url"))
        else None,
        axis=1,
    )
    patreon_matched = df["patreon_url"].notna().sum()
    print(f"  → {patreon_matched} episodes linked to a Patreon collection")

    out = DATA_DIR / "episodes.json"
    df.to_json(out, orient="records", force_ascii=False)
    print(f"  → {len(df)} episodes → {out}")


if __name__ == "__main__":
    export_comics()
    export_episodes()
    print("\nDone. Commit data/comics.json and data/episodes.json.")
