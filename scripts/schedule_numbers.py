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
recorded no more than LAG_MAX days before it aired. Nearly all land at exactly 3 days, the
Sunday-record/Wednesday-air gap. The lag spread is the check that matters, and `main()` prints
it: a match drifting out toward the 14-day limit is the shape a wrong match has.

Rows with a `Release` date, which the workbook has carried since EP. 532, skip all of that and
match the feed on the date itself. See `align()` for why the lag rule cannot number them.

Episodes that match no sheet row keep NO number. They are the separately-numbered minisodes
and the untitled one-offs, and the sheet lists them with a blank `Ep` — inventing a number
for them is what the current code already does wrong.

The workbook is not public, and there are two ways to read it. CI passes the URL of the
Apps Script web app in scripts/schedule-webapp.gs, which serves the same cells as JSON:

    python scripts/schedule_numbers.py "$SCHEDULE_WEBAPP_URL"

By hand, pull it from Drive as xlsx (its native export truncates and silently drops rows)
and pass the path. This still works when the web app does not, which is the point of keeping
it:

    python scripts/schedule_numbers.py ~/Downloads/schedule.xlsx

Writes data/episode-numbers.csv, which is checked in and reviewable in a diff so the pipeline
never needs a live Sheets dependency.
"""
import csv
import json
import re
import sys
from datetime import datetime, timedelta
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
TABS = (("Old Recording Dates", "Rec. Date"), ("Schedule", "Rec. Date"))


def _ep(v):
    """(number, is_an_episode). A fractional Ep — 475.1, 522.1 — is a *skipped* week.

    They are labelled "NO EPISODE IN JULY?" in the 2025 run and left blank in the 2026 one,
    and they carry no host and no topic. Rounding them down to 475 or 522 hands the real
    episode a recording date belonging to a week it was not recorded in.
    """
    try:
        f = float(str(v).strip())
    except (TypeError, ValueError):
        return None, False
    return int(f), f == int(f)


def _as_date(v):
    """A cell's date, or None when the walk has to reconstruct it.

    openpyxl hands back a datetime; the web app hands back "2020-01-05" already formatted in
    the spreadsheet's timezone. Everything else -- "Done", blank, None -- is a cell with no
    date in it, which is a fact the walk needs rather than an error.
    """
    if isinstance(v, datetime):
        return v
    try:
        return datetime.fromisoformat(str(v).strip()[:10])
    except ValueError:
        return None


def _rows_from_xlsx(xlsx):
    """(tab, ep, rec, topic, release) in sheet order."""
    wb = openpyxl.load_workbook(xlsx, read_only=True, data_only=True)
    out = []
    for tab, datecol in TABS:
        ws = wb[tab]
        it = ws.iter_rows(values_only=True)
        hdr = [str(c).strip() if c is not None else "" for c in next(it)]
        for raw in it:
            if all(c is None or str(c).strip() == "" for c in raw):
                continue
            r = dict(zip(hdr, raw))
            out.append((tab, r.get("Ep"), r.get(datecol), r.get("Topic"), r.get("Release")))
    return out


def _rows_from_webapp(url):
    """The same rows from scripts/schedule-webapp.gs.

    An Apps Script web app cannot set an HTTP status, so a refused token or a lost share
    arrives as a 200 carrying {"error": ...}. Reading that as a sheet with no rows in it
    would write an empty CSV and drop every episode number the site has, so it stops here.
    """
    import urllib.request
    with urllib.request.urlopen(url, timeout=60) as resp:
        payload = json.loads(resp.read())
    if "error" in payload:
        raise SystemExit(f"schedule web app: {payload['error']}")
    # .get: a deployment older than the Release column sends none, and still numbers by lag.
    return [(r["tab"], r["ep"], r["rec"], r["topic"], r.get("release")) for r in payload["rows"]]


def read_sheet(src):
    """One row per week in order, ascending by episode number.

    `Rec. Date` is overwritten with "Done"/"DONE" once a recording is in the can, so the date
    is gone by the time the episode airs. Requiring one silently dropped 33 rows — which is
    every missing number on the site, exactly — and, worse, slid later numbers onto earlier
    episodes, because the skipped-week rows kept their dates and got claimed in their place.

    A missing date is recoverable because the rows are a weekly timeline and the skipped weeks
    are rows too: walk 7 days per row from the last dated row. Across the 129 dated rows either
    side of these gaps in the numbering era that depends on the sheet (Ep 400+, where the RSS
    title no longer states a number), the walk lands exactly on the next dated row every time
    but twice — one June 2024 stretch that shifted a day. The alignment window is 14 days, so a
    reconstruction has to be a fortnight wrong before it can pick the wrong episode.
    """
    return _walk(_rows_from_webapp(src) if str(src).startswith("http") else _rows_from_xlsx(src))


def _walk(raw):
    """The weekly timeline, over rows from either reader. `selfcheck` covers both."""
    rows, tab_seen, week = {}, None, None
    for tab, ep_raw, rec_raw, topic, release in raw:
        if tab != tab_seen:
            tab_seen, week = tab, None        # each tab is its own timeline
        ep, is_episode = _ep(ep_raw)
        if ep is None:
            continue
        rec = _as_date(rec_raw)
        if rec is not None:
            week = rec
        elif week is None:
            continue                          # nothing to count from yet
        else:
            week = rec = week + timedelta(days=7)
        if not is_episode:
            continue                          # a skipped week holds its place and nothing else
        # Four numbers appear twice, rescheduled. The later row is the one that happened.
        if ep not in rows or rec > rows[ep]["rec"]:
            rows[ep] = {"ep": ep, "rec": rec, "topic": topic, "release": _as_date(release)}
    return [rows[k] for k in sorted(rows)]


def align(sheet, feed):
    """Monotone alignment: numbers ascend with air date, and no row is claimed twice.

    A row with a Release date is claimed on that date and no other, because recording order
    stopped being episode order: EP. 534 was recorded 2026-09-10 and released 2026-10-07, with
    532 and 533 recorded and aired in between. No lag window survives that. At 14 days 534 is
    never in reach and every later number slides up one; at 42 it is in reach too early, and
    takes 533's 2026-09-30 slot because the newest eligible row wins. `check()` passes both.
    """
    out, cursor = [], 0
    for pos, ep in enumerate(feed, start=1):
        air = datetime.fromisoformat(ep["date"][:19].replace("Z", ""))
        best = None
        for j in range(cursor, len(sheet)):
            row = sheet[j]
            if row["release"] is not None:
                if row["release"].date() == air.date():
                    best = (j, row, (air - row["rec"]).days)
                if row["release"].date() >= air.date():
                    break                     # Release ascends with Ep, so nothing later fits
                continue
            lag = (air - row["rec"]).days
            if lag < 0:
                break
            if lag <= LAG_MAX:
                best = (j, row, lag)
        if best:
            j, row, lag = best
            out.append({"ep": row["ep"], "key": ep["key"], "date": ep["date"][:10],
                        "title": ep["title"] or "", "shown_as": pos,
                        "rec_date": row["rec"].date().isoformat(), "lag_days": lag,
                        "topic": (row["topic"] or "").strip(),
                        "source": "schedule-release" if row["release"] else "schedule-sheet"})
            cursor = j + 1
    return out


def check(matched, sheet):
    """The alignment is only trustworthy if it is monotone and every lag is sane."""
    eps = [m["ep"] for m in matched]
    assert eps == sorted(eps), "episode numbers must ascend with air date"
    assert len(set(eps)) == len(eps), "an episode number was claimed twice"
    keys = [m["key"] for m in matched]
    assert len(set(keys)) == len(keys), "a feed episode was numbered twice"
    # A Release match states its own date, so its lag is a banking gap, not a matching error.
    assert all(m["source"] == "schedule-release" or 0 <= m["lag_days"] <= LAG_MAX
               for m in matched), "lag outside the sane window"
    # Release is the *planned* date. An episode that slipped, or a date typed a day off, leaves
    # its row unclaimed: the next episode then takes the following row and every number after
    # it is one off, valid by every rule above. Stop rather than write that.
    newest = max((m["date"] for m in matched), default="")
    missed = [r["ep"] for r in sheet if r["release"] and r["ep"] not in eps
              and r["release"].date().isoformat() <= newest]
    assert not missed, f"Release date passed with no episode on it, fix the sheet: EP. {missed}"


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


def main(src):
    core = json.loads(CORE.read_text())
    feed = sorted([e for e in core["episodes"] if e.get("showId") and e.get("date")],
                  key=lambda e: e["date"])
    sheet = read_sheet(src)
    matched = align(sheet, feed)
    check(matched, sheet)

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


def selfcheck():
    """The two rules that recover a date, and the banked episode, on a sheet small enough to read.

    `check()` guards the alignment on real data every run, but it cannot see this class of
    fault: dropping a row produces an alignment that is monotone, unique and inside the lag
    window — valid in every way it knows to test, and quietly missing 33 episodes. A banked
    episode numbered by lag is the same shape: valid, and one number off.
    """
    import io

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = TABS[0][0]
    ws.append(["Ep", TABS[0][1], "Topic"])
    sheet_rows = [
        [100, datetime(2020, 1, 5), "dated"],
        [101, "DONE", "recorded, date overwritten"],     # -> 2020-01-12, one week on
        [102, datetime(2020, 1, 19), "dated again"],     # a real date always wins
        [103, datetime(2020, 1, 26), "dated"],
        ["103.1", datetime(2020, 2, 2), None],           # a skipped week, not episode 103
        [104, "Done", "after the skipped week"],         # -> 2020-02-09, counting past it
    ]
    for row in sheet_rows:
        ws.append(row)
    ws = wb.create_sheet(TABS[1][0])
    ws.append(["Ep", TABS[1][1], "Topic", "Release"])
    release_rows = [
        [105, datetime(2020, 2, 16), "on time", datetime(2020, 2, 19)],
        [106, datetime(2020, 2, 23), "on time", datetime(2020, 2, 26)],
        [107, datetime(2020, 1, 30), "banked a month early", datetime(2020, 3, 4)],
        [108, datetime(2020, 3, 2), "recorded before 107 aired", datetime(2020, 3, 11)],
    ]
    for row in release_rows:
        ws.append(row)

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    sheet = read_sheet(buf)
    got = {r["ep"]: r["rec"].date().isoformat() for r in sheet}

    assert got[101] == "2020-01-12", f"'DONE' should count a week on from 100, got {got[101]}"
    assert got[102] == "2020-01-19", "a stated date must beat the reconstruction"
    assert got[103] == "2020-01-26", f"103.1 is a skipped week, not 103's date, got {got[103]}"
    assert got[104] == "2020-02-09", f"the skipped week still costs a week, got {got[104]}"
    assert sorted(got) == [100, 101, 102, 103, 104, 105, 106, 107, 108], \
        f"103.1 is not an episode: {sorted(got)}"

    # Same cells over the web app's wire format, where a date is already a "2020-01-05"
    # string and an empty cell is "". Two readers feeding one walk is only safe while they
    # agree, and CI uses the one with no test of its own.
    iso = lambda v: v.date().isoformat() if isinstance(v, datetime) else (v or "")
    served = _walk([(TABS[0][0], ep, iso(rec), topic or "", "") for ep, rec, topic in sheet_rows]
                   + [(TABS[1][0], ep, iso(rec), topic, iso(rel))
                      for ep, rec, topic, rel in release_rows])
    pick = lambda rows: [(r["ep"], r["rec"], r["release"]) for r in rows]
    assert pick(served) == pick(sheet), \
        "the web app JSON and the workbook must read the same timeline"

    # 2026-10-07 in miniature. By lag, 108 (recorded 2020-03-02) takes 107's 2020-03-04 slot
    # and 108's own week goes unnumbered; check() would pass that.
    feed = [{"date": f"{d}T10:00:00Z", "key": d, "title": ""}
            for d in ("2020-02-12", "2020-02-19", "2020-02-26", "2020-03-04", "2020-03-11")]
    matched = align(sheet, feed)
    check(matched, sheet)
    nums = [m["ep"] for m in matched]
    assert nums == [104, 105, 106, 107, 108], f"a banked episode keeps its own number, got {nums}"

    # 107 slips a week and its Release is left at the plan: 108's row would take its slot.
    slipped = [f for f in feed if f["key"] != "2020-03-04"]
    try:
        check(align(sheet, slipped), sheet)
    except AssertionError:
        pass
    else:
        raise AssertionError("a passed Release date with no episode on it must fail check()")
    print("selfcheck ok")


if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] == "--selfcheck":
        selfcheck()
    elif len(sys.argv) != 2:
        sys.exit(__doc__)
    else:
        main(sys.argv[1])
