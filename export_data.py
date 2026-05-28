#!/usr/bin/env python3
"""
Export IRCB data from sshugars/ircb to JSON for the search UI.
Run this whenever the source data is updated.

Requirements: pip install pandas openpyxl
"""

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


def build_player_id_map():
    """Return {simplecast_url_base → player_uuid} extracted from the RSS enclosure CDN paths."""
    print("Fetching RSS feed for Simplecast player IDs...")
    with urllib.request.urlopen(RSS_URL) as resp:
        rss_bytes = resp.read()
    tree = ET.fromstring(rss_bytes)
    player_map = {}
    for item in tree.iter("item"):
        link_el = item.find("link")
        enc_el = item.find("enclosure")
        if link_el is None or enc_el is None:
            continue
        link = (link_el.text or "").split("?")[0].rstrip("/")
        enc_url = enc_el.get("url", "")
        m = _EPISODE_UUID_RE.search(enc_url)
        if m and link:
            player_map[link] = m.group(1)
    print(f"  → {len(player_map)} player IDs extracted from RSS")
    return player_map


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


def export_episodes():
    print("Fetching episodes data from GitHub...")
    df = pd.read_excel(EPISODES_URL, engine="openpyxl")
    df = df[[c for c in EPISODE_COLS if c in df.columns]]

    player_map = build_player_id_map()

    def lookup_player_id(url):
        if not url or (isinstance(url, float)):
            return None
        return player_map.get(str(url).split("?")[0].rstrip("/"))

    df["player_id"] = df["simplecast_url"].apply(lookup_player_id)
    matched = df["player_id"].notna().sum()
    print(f"  → {matched}/{len(df)} episodes matched to a Simplecast player ID")

    out = DATA_DIR / "episodes.json"
    df.to_json(out, orient="records", force_ascii=False)
    print(f"  → {len(df)} episodes → {out}")


if __name__ == "__main__":
    export_comics()
    export_episodes()
    print("\nDone. Commit data/comics.json and data/episodes.json.")
