#!/usr/bin/env python3
"""Align the IRCB Schedule workbook to the feed and emit real episode numbers.

The site has no real episode numbers. `src/data/numbering.ts` numbers feed episodes 1..N by
air date, but the feed starts at episode 85 and carries 162 minisodes, interviews, bonuses
and annuals that never consumed an episode number. The result drifts: the episode titled
"400 Episodes of FOMO" is labelled EP. 435 and "500 Episodes and We've Finally Figured Out
Comic Books" is labelled EP. 543.

The workbook has the real numbers. It records *recording* dates and the feed records *air*
dates, and the titles carry no "Episode N |" prefix to join on (upstream strips it), so the
join is a monotone alignment on date: each feed episode takes the latest unclaimed sheet row
recorded no more than LAG_MAX days before it aired. 378 of 406 land at exactly 3 days.

Episodes that match no sheet row keep NO number. They are the separately-numbered minisodes
and the untitled one-offs, and the sheet lists them with a blank `Ep` — inventing a number
for them is what the current code already does wrong.

The workbook is not public. Pull it from Drive as xlsx (its native export truncates and
silently drops rows) and pass the path:

    python scripts/schedule_numbers.py ~/Downloads/schedule.xlsx

Writes data/episode-numbers.csv, which is checked in and reviewable in a diff so the pipeline
never needs a live Sheets dependency.
"""
import csv
import json
import re
import sys
from datetime import datetime
from pathlib import Path

import xml.etree.ElementTree as ET

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
CORE = ROOT / "public/d/core.json"
RSS_URL = "https://feeds.simplecast.com/U93zjuSN"
OUT = ROOT / "data/episode-numbers.csv"

# Recorded Sunday, aired Wednesday. 10 is the longest real gap observed (a holiday week);
# anything past 14 is a different episode and must not be claimed.
LAG_MAX = 14
TABS = (("Old Recording Dates", "Recording Date"), ("Schedule", "Rec. Date"))


def _ep(v):
    try:
        return int(float(str(v).strip()))
    except (TypeError, ValueError):
        return None


def read_sheet(xlsx):
    """Numbered rows carrying a recording date, one per episode number, ascending."""
    wb = openpyxl.load_workbook(xlsx, read_only=True, data_only=True)
    rows = {}
    for tab, datecol in TABS:
        ws = wb[tab]
        it = ws.iter_rows(values_only=True)
        hdr = [str(c).strip() if c is not None else "" for c in next(it)]
        for raw in it:
            if all(c is None or str(c).strip() == "" for c in raw):
                continue
            r = dict(zip(hdr, raw))
            ep, rec = _ep(r.get("Ep")), r.get(datecol)
            if ep is None or not isinstance(rec, datetime):
                continue
            # Four numbers appear twice, rescheduled. The later row is the one that happened.
            if ep not in rows or rec > rows[ep]["rec"]:
                rows[ep] = {"ep": ep, "rec": rec, "topic": r.get("Topic")}
    return [rows[k] for k in sorted(rows)]


def align(sheet, feed):
    """Monotone alignment: numbers ascend with air date, and no row is claimed twice."""
    out, cursor = [], 0
    for pos, ep in enumerate(feed, start=1):
        air = datetime.fromisoformat(ep["date"][:19].replace("Z", ""))
        best = None
        for j in range(cursor, len(sheet)):
            lag = (air - sheet[j]["rec"]).days
            if lag < 0:
                break
            if lag <= LAG_MAX:
                best = (j, sheet[j], lag)
        if best:
            j, row, lag = best
            out.append({"ep": row["ep"], "key": ep["key"], "date": ep["date"][:10],
                        "title": ep["title"] or "", "shown_as": pos,
                        "rec_date": row["rec"].date().isoformat(), "lag_days": lag,
                        "topic": (row["topic"] or "").strip()})
            cursor = j + 1
    return out


def check(matched):
    """The alignment is only trustworthy if it is monotone and every lag is sane."""
    eps = [m["ep"] for m in matched]
    assert eps == sorted(eps), "episode numbers must ascend with air date"
    assert len(set(eps)) == len(eps), "an episode number was claimed twice"
    keys = [m["key"] for m in matched]
    assert len(set(keys)) == len(keys), "a feed episode was numbered twice"
    assert all(0 <= m["lag_days"] <= LAG_MAX for m in matched), "lag outside the sane window"


TITLE_NUM = re.compile(r"^\s*(?:i read comic books\s+)?episode\s+(\d+)\s*\|", re.I)


def feed_title_numbers():
    """The number the show itself printed in the RSS title, until it stopped in Jan 2024.

    This is the authoritative source wherever it exists, and it is also the only independent
    check on the sheet alignment — they agree on all 300 rows they share.
    """
    import urllib.request
    with urllib.request.urlopen(RSS_URL) as resp:
        tree = ET.fromstring(resp.read())
    out = {}
    for item in tree.iter("item"):
        title = item.findtext("title") or ""
        m = TITLE_NUM.match(title)
        if m:
            out[_titlekey(title)] = int(m.group(1))
    return out


def _titlekey(t):
    t = TITLE_NUM.sub("", t or "")
    return re.sub(r"[^a-z0-9]+", "", t.lower())


def main(xlsx):
    core = json.loads(CORE.read_text())
    feed = sorted([e for e in core["episodes"] if e.get("showId") and e.get("date")],
                  key=lambda e: e["date"])
    sheet = read_sheet(xlsx)
    matched = align(sheet, feed)
    check(matched)

    stated = feed_title_numbers()
    disagree = []
    for m in matched:
        n = stated.get(_titlekey(m["title"]))
        m["feed_title_ep"] = n if n is not None else ""
        if n is not None and n != m["ep"]:
            disagree.append((m["title"], m["ep"], n))
        if n is not None:
            m["ep"] = n                      # the show's own number always wins
            m["source"] = "feed-title"
        else:
            m["source"] = "schedule-sheet"

    OUT.parent.mkdir(exist_ok=True)
    cols = ["ep", "source", "shown_as", "delta", "date", "title", "feed_title_ep",
            "rec_date", "lag_days", "topic", "key"]
    with open(OUT, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for m in matched:
            w.writerow({**m, "delta": m["shown_as"] - m["ep"]})

    wrong = sum(1 for m in matched if m["shown_as"] != m["ep"])
    deltas = {m["shown_as"] - m["ep"] for m in matched}
    confirmed = sum(1 for m in matched if m["source"] == "feed-title")
    print(f"sheet rows usable: {len(sheet)}   feed episodes: {len(feed)}")
    print(f"numbered: {len(matched)}   unnumbered -> bonus: {len(feed) - len(matched)}")
    print(f"  confirmed by the show's own RSS title : {confirmed}")
    print(f"  from the schedule sheet alone         : {len(matched) - confirmed}  <- review these")
    print(f"  the two sources DISAGREE on           : {len(disagree)}")
    for t, a, b in disagree[:10]:
        print(f"      {t[:50]!r}: sheet {a}, feed title {b}")
    print(f"currently displayed WRONG: {wrong}   distinct offsets: {len(deltas)} "
          f"({min(deltas)}..{max(deltas)})")
    print(f"newest numbered episode: EP. {matched[-1]['ep']} (site shows {matched[-1]['shown_as']})")
    print(f"→ {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
