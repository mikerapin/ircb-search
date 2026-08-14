#!/usr/bin/env python3
"""
Export IRCB data from sshugars/ircb to JSON for the search UI.
Run this whenever the source data is updated.

Requirements: pip install pandas openpyxl
"""

import csv
import json
import os
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
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
NUMBERS_CSV = DATA_DIR / "episode-numbers.csv"
RSS_URL = "https://feeds.simplecast.com/U93zjuSN"

COMIC_COLS = ["comic", "show_id", "segment", "timestamp", "direct_url"]
EPISODE_COLS = ["show_id", "title", "date", "people", "keywords", "simplecast_url"]

# How long a public episode may be absent from the upstream table before that is a fault rather
# than a normal gap. An episode is public at Wed 10:00 UTC and sshugars/ircb regenerates its
# tables at Wed 16:00, so the Wednesday refresh at 17:00 legitimately sees a few hours of lag if
# that job is merely slow. By the Thursday refresh at 03:00 the episode is 17 hours old and a
# gap means the job did not run. Twelve hours separates those two without this needing to know
# which refresh it is.
STALE_AFTER_HOURS = 12

_ITUNES_NS = "http://www.itunes.com/dtds/podcast-1.0.dtd"


def build_rss_maps():
    """Return {url → {summary, enclosure_url, artwork_url, duration_secs, panel, …}} from RSS."""
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
        rec = {"summary": None, "enclosure_url": None,
               "artwork_url": None, "duration_secs": None, "panel": [],
               # Carried so append_missing() can build a table row out of a feed item. The
               # guid is the same UUID the upstream table stores as show_id, which is what
               # keeps the key stable when the table catches up — see append_missing.
               "title": (item.findtext("title") or "").strip() or None,
               "date": item.findtext("pubDate"),
               "show_id": (item.findtext("guid") or "").strip() or None,
               "keywords": item.findtext(f"{{{_ITUNES_NS}}}keywords"),
               # Only a `full` item is ever expected to carry an episode number — minisodes
               # are numbered in their own run and bonuses take none. See _report_unnumbered.
               "episode_type": item.findtext(f"{{{_ITUNES_NS}}}episodeType")}
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
            rec["enclosure_url"] = enc_el.get("url", "") or None
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
    stale = []
    for r in new:
        hours = _hours_public(r["date"])
        print(f"  + {r['title']} — in the feed, not yet in the table")
        if hours is not None and hours > STALE_AFTER_HOURS:
            stale.append(f"{r['title']} ({hours:.0f}h public)")
    _report_stale(stale)
    return pd.concat([df, pd.DataFrame(new)], ignore_index=True)


def _hours_public(pubdate):
    """Hours since an RFC-2822 pubDate, or None if it will not parse."""
    try:
        published = parsedate_to_datetime(pubdate)
    except (TypeError, ValueError):
        return None
    if published.tzinfo is None:
        published = published.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - published).total_seconds() / 3600


def _report_stale(stale):
    """Tell CI the upstream table has fallen behind, rather than merely being early.

    Deliberately a signal and not an exit: the backfill above means the site already has the
    episode, so a late table costs comics and timestamps, not the episode itself. That is worth
    an email, never a reason to abandon the refresh — the workflow reads this at the very end,
    after the data is committed and the deploy asked for, and fails the job then.

    The 2026-08-12 miss went unnoticed for a day precisely because nothing did this. It was
    also the third miss of the year, after 04-22 and 06-03, and none of them announced itself.
    """
    if not stale:
        return
    print(f"  ! the upstream table is behind: {'; '.join(stale)}")
    github_output = os.environ.get("GITHUB_OUTPUT")
    if github_output:
        with open(github_output, "a") as f:
            f.write(f"stale={len(stale)}\n")


def _report_unnumbered(rss):
    """Say when episodes have aired since data/episode-numbers.csv was last topped up.

    Episode numbers exist in exactly one place: the private IRCB Schedule workbook. They are
    not in the feed — there is no itunes:episode tag on any item — nor in the show notes, and
    they cannot be counted out, because a handful of episodes since 2024 took no number at all.
    So the CSV is refreshed by hand, and the only real risk is that nobody notices it needs
    to be.

    Nobody did. Numbers went missing from 2024-03 to 2026-08 and the site simply showed no
    EP. line, which looks like a design decision rather than a fault.

    Trailing episodes only, counted by air date rather than by key, so it measures the one
    thing that matters — how many have aired since the newest row in the CSV. An episode that
    legitimately takes no number sits *between* numbered ones, so it leaves the trailing set
    as soon as the next episode is numbered. Two is the trigger because the longest run of
    consecutive unnumbered `full` items since 2024 is one; two in a row has never happened
    without the CSV being behind.
    """
    if not NUMBERS_CSV.exists():
        return
    rows = list(csv.DictReader(NUMBERS_CSV.open()))
    if not rows:
        return
    newest = max(r["date"] for r in rows)
    later = sorted(
        aired for aired in (_airdate(rec["date"]) for rec in rss.values()
                            if rec["episode_type"] == "full")
        if aired and aired > newest)
    print(f"  → {len(later)} episode(s) aired since the newest numbered one ({newest})")
    if len(later) < 2:
        return
    print(f"  ! data/episode-numbers.csv is behind: {', '.join(later)}")
    github_output = os.environ.get("GITHUB_OUTPUT")
    if github_output:
        with open(github_output, "a") as f:
            f.write(f"unnumbered={len(later)}\n")


def _airdate(pubdate):
    """The RFC-2822 pubDate as a plain ISO date, comparable to the CSV's own date column."""
    try:
        return parsedate_to_datetime(pubdate).date().isoformat()
    except (TypeError, ValueError):
        return None


def export_episodes():
    print("Fetching episodes data from GitHub...")
    df = pd.read_excel(EPISODES_URL, engine="openpyxl")
    df = df[[c for c in EPISODE_COLS if c in df.columns]]

    rss = build_rss_maps()
    df = append_missing(df, rss)
    _report_unnumbered(rss)

    def rss_field(url, field):
        if not url or isinstance(url, float):
            return None
        rec = rss.get(str(url).split("?")[0].rstrip("/"))
        return rec[field] if rec else None

    for field in ("summary", "enclosure_url", "artwork_url", "duration_secs", "panel"):
        df[field] = df["simplecast_url"].apply(lambda u, f=field: rss_field(u, f))
    # Counted on the enclosure, because that is the field the site actually plays. This used
    # to count player_id, parsed out of the enclosure path — a CDN asset id that no view ever
    # read, and that silently went null for every episode once Simplecast changed the path
    # shape. The number it printed said "matched" while dropping by one a week.
    matched = df["enclosure_url"].notna().sum()
    print(f"  → {matched}/{len(df)} episodes joined to an RSS enclosure")
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
