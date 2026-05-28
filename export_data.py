#!/usr/bin/env python3
"""
Export IRCB data from sshugars/ircb to JSON for the search UI.
Run this whenever the source data is updated.

Requirements: pip install pandas openpyxl
"""

import json
import sys
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

COMIC_COLS = ["comic", "show_id", "segment", "timestamp", "direct_url"]
EPISODE_COLS = ["show_id", "title", "date", "people", "keywords", "simplecast_url"]


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
    out = DATA_DIR / "episodes.json"
    df.to_json(out, orient="records", force_ascii=False)
    print(f"  → {len(df)} episodes → {out}")


if __name__ == "__main__":
    export_comics()
    export_episodes()
    print("\nDone. Commit data/comics.json and data/episodes.json.")
