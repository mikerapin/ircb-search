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
    """Return ({url → player_uuid}, {url → summary}) extracted from the RSS feed."""
    print("Fetching RSS feed for Simplecast player IDs and episode summaries...")
    with urllib.request.urlopen(RSS_URL) as resp:
        rss_bytes = resp.read()
    tree = ET.fromstring(rss_bytes)
    player_map = {}
    summary_map = {}
    for item in tree.iter("item"):
        link_el = item.find("link")
        if link_el is None:
            continue
        link = (link_el.text or "").split("?")[0].rstrip("/")
        enc_el = item.find("enclosure")
        if enc_el is not None:
            m = _EPISODE_UUID_RE.search(enc_el.get("url", ""))
            if m and link:
                player_map[link] = m.group(1)
        summary_el = item.find(f"{{{_ITUNES_NS}}}summary")
        if summary_el is not None and summary_el.text and link:
            summary_map[link] = summary_el.text.strip()
    print(f"  → {len(player_map)} player IDs, {len(summary_map)} summaries extracted from RSS")
    return player_map, summary_map


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


def export_episodes():
    print("Fetching episodes data from GitHub...")
    df = pd.read_excel(EPISODES_URL, engine="openpyxl")
    df = df[[c for c in EPISODE_COLS if c in df.columns]]

    player_map, summary_map = build_rss_maps()

    def lookup_rss(url, rss_map):
        if not url or isinstance(url, float):
            return None
        return rss_map.get(str(url).split("?")[0].rstrip("/"))

    df["player_id"] = df["simplecast_url"].apply(lambda u: lookup_rss(u, player_map))
    df["summary"]   = df["simplecast_url"].apply(lambda u: lookup_rss(u, summary_map))
    matched = df["player_id"].notna().sum()
    print(f"  → {matched}/{len(df)} episodes matched to a Simplecast player ID")

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
