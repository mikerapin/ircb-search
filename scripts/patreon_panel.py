#!/usr/bin/env python3
"""Propose a panel for the Patreon episodes that have none. Review file, not a pipeline step.

193 Patreon episodes carry no panel: the read-along runs credit nobody, and only post-credits
segments can borrow a parent's. Sources, in the order they are trusted:

  a public counterpart   Some "Patreon" minisodes are the public episode under a different
                         number — Patreon's "Minisode 21 | Planetary vs Fire & Stone" is the
                         feed's Minisode 22. Those are not Patreon-exclusive at all.
  a stated rule          data/patreon-panel-rules.json. Saga of Saga hosts are per volume of
                         six issues; Doom Patrol names its pair in the title; Movie Club has a
                         standing trio. A description naming a roster member overrides a
                         standing panel, so a stand-in is picked up rather than papered over.
  the description        Names in the prose, cut where the sentence turns from who is here to
                         what was made ("Directed by") — the fix that stopped Movie Club #26
                         crediting the screenwriter Danny Bilson as Daniel Martinez.

Why this writes a CSV rather than episode data: prose is not a panel field, and reading one
out of the other has a ceiling. "IRCB's Best of 2022" names all ten regulars because it lists
whose picks were discussed, not who recorded. A wrong name puts someone on an episode they
were never on, which is the failure this project already fought once with spaCy, so every row
here wants an eye before it becomes a panel.

Going forward the fix is upstream of all of it: a `Panel: Mike Rapin, Kara Szamborski` line in
the description, with full names, removes both failure modes at once and makes every rule in
patreon-panel-rules.json a one-time backfill rather than a standing dependency.

    python scripts/patreon_panel.py
"""
import csv
import json
import math
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data/patreon-panel-proposed.csv"
RULES = json.loads((ROOT / "data/patreon-panel-rules.json").read_text())

ROSTER = {
    "Mike": "Mike Rapin", "Brian": "Brian Murray", "Danny": "Daniel Martinez",
    "Daniel": "Daniel Martinez", "Kait": "Kait Lamphere", "Kara": "Kara Szamborski",
    "Kate": "Kate Skocelas", "Nick": "Nick White", "Paloma": "Paloma Deerfield",
    "Paul": "Paul Jaissle", "René": "René Rodriguez", "Rene": "René Rodriguez",
    "Tia": "Tia Vasiliou", "Zach": "Zach McCrary", "Zander": "Zander",
}

CUT = re.compile(
    r"\b(written|directed|created|drawn|illustrated|published|based|adapted)\s+by\b"
    r"|\b(his|her|their|’s|'s)\s+pick\b"
    r"|\bpick\s+(is|was)\b",
    re.I,
)
CAUTION = re.compile(r"\b(mind|pick|choice|selection)\s+of\s+([A-Z][a-z]+)"
                     r"|\b([A-Z][a-z]+)\s+in\s+(his|her|their)\s+pick", re.I)
SAGA_ISSUE = re.compile(r"saga of saga.*?issue\s*#?\s*(\d+)", re.I)
SAGA_WRAP = re.compile(r"saga of saga.*?vol(?:ume)?\.?\s*(\d+)\s*wrap", re.I)


def strip_html(s):
    return re.sub(r"<[^>]+>", " ", s or "")


def prose(summary):
    """The opening prose, stopped where it turns to the work.

    Not the first sentence alone: "Continuing... Mike and Kara!" puts the panel in the second
    fragment, and that lost every Saga episode written that way.
    """
    txt = re.sub(r"\s+", " ", strip_html(summary)).strip()[:400]
    m = CUT.search(txt)
    return txt[:m.start()] if m else txt


def names_in(fragment):
    """Roster members named in a fragment.

    A first name carrying someone else's surname is someone else: "Daniel Clowes" wrote Ghost
    World and "Danny Bilson" wrote The Rocketeer, and both would otherwise land as Daniel
    Martinez. So a roster first name followed by a capitalised word only counts when the pair
    is that person's actual full name.

    Naming someone as the *pick* does NOT mean they were absent — Movie Club #24 reads "the
    prepubescent mind of Mike in his pick" and Mike was on it, confirmed by both Mike and the
    schedule sheet. Those rows still carry a `caution` flag for review, but the name stays.
    """
    toks = re.findall(r"[A-ZÀ-Þ][a-zà-ÿé]+|\S+", fragment or "")
    out, seen = [], set()
    for i, tok in enumerate(toks):
        who = ROSTER.get(tok)
        if not who or who in seen:
            continue
        nxt = toks[i + 1] if i + 1 < len(toks) else ""
        if re.fullmatch(r"[A-ZÀ-Þ][a-zà-ÿé]+", nxt) and f"{tok} {nxt}" != who:
            continue                      # a different person who shares the first name
        seen.add(who)
        out.append(who)
    return out


def from_title(title):
    """"…Uncovered with Kara and Tia" states its panel outright."""
    m = re.search(r"\bwith\s+(.+?)(?:\s*#|$)", title or "")
    return names_in(m.group(1)) if m else []


def propose(title, summary, public_panels):
    """-> (panel, source, flag, evidence)"""
    if title in RULES.get("hold", {}):
        return [], "hold", "hold", RULES["hold"][title]

    if title in RULES["publicCounterpart"]:
        return [], "public-counterpart", "not-patreon-exclusive", RULES["publicCounterpart"][title]

    ep = RULES["fromPublicEpisode"].get(title)
    if ep is not None:
        return public_panels.get(ep, []), "public-episode", "", f"panel of public EP. {ep}"

    desc = names_in(prose(summary))

    m = SAGA_ISSUE.search(title or "")
    if m:
        vol = str(math.ceil(int(m.group(1)) / 6))
        hosts = RULES["sagaVolumes"].get(vol)
        if hosts:
            return hosts, "saga-volume", "", f"issue {m.group(1)} -> volume {vol}"
    m = SAGA_WRAP.search(title or "")
    if m:
        vol = m.group(1)
        # The description is the record and the table is the plan, so it wins where it exists:
        # volume 2's row says "Everyone" while its own description names three.
        if len(desc) >= 2:
            return desc, "saga-wrap+description", "", prose(summary)[:180]
        extra = [n for n in RULES["sagaWrapExtra"].get(vol, []) if not n.startswith("_")]
        hosts = RULES["sagaVolumes"].get(vol, [])
        both = list(dict.fromkeys(hosts + extra))
        if both:
            return both, "saga-wrap", "", f"volume {vol} hosts + summary"

    m = re.search(r"saga of saga.*?vol(?:ume)?\.?\s*(1[012])\b", title or "", re.I)
    if m:
        who = RULES["sagaVolumeEpisodes"].get(m.group(1))
        if who:
            return who, "saga-volume-doc", "", f"prep-doc notes under Volume {m.group(1)}"

    for rule in RULES["seriesPanels"]:
        if rule["match"].lower() not in (title or "").lower():
            continue
        if rule.get("unlessDescriptionNames") and desc:
            base = rule.get("alwaysInclude", [])
            merged = list(dict.fromkeys(base + desc))
            stood_in = "stand-in" if set(merged) != set(rule.get("panel", merged)) else ""
            return merged, "series+description", stood_in, prose(summary)[:180]
        if rule.get("panel"):
            return rule["panel"], "series-default", "", rule["why"]
        if rule.get("alwaysInclude"):
            return rule["alwaysInclude"], "series-default", "", rule["why"]

    titled = from_title(title)
    if titled:
        return titled, "title", "", title

    flag = "caution" if CAUTION.search(prose(summary)) else ""
    return desc, "description", flag, prose(summary)[:180]


def main():
    core = json.loads((ROOT / "public/d/core.json").read_text())
    eps = core["episodes"]
    nopanel = [e for e in eps if not e.get("people") and e.get("patreonUrl")]
    raw = {r["title"]: r for r in json.loads((ROOT / "data/patreon.json").read_text())["episodes"]}

    numbers = {}
    npath = ROOT / "data/episode-numbers.csv"
    if npath.exists():
        bykey = {e["key"]: e for e in eps}
        for r in csv.DictReader(open(npath)):
            ep = bykey.get(r["key"])
            if ep:
                numbers[int(r["ep"])] = ep.get("people") or []

    rows = []
    for e in sorted(nopanel, key=lambda e: (e.get("date") or "", e["title"])):
        rec = raw.get(e["title"]) or {}
        people, source, flag, evidence = propose(e["title"], rec.get("summary", ""), numbers)
        rows.append({
            "date": (e.get("date") or "")[:10],
            "title": e["title"],
            "proposed": "; ".join(people),
            "n": len(people),
            "source": source if (people or flag) else "",
            "flag": flag or ("" if people else "none-found"),
            "evidence": str(evidence)[:180],
            "key": e["key"],
        })

    with open(OUT, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)

    got = [r for r in rows if r["n"]]
    print(f"Patreon episodes with no panel: {len(rows)}")
    print(f"  panel proposed : {len(got)}")
    print(f"  still nothing  : {sum(1 for r in rows if r['flag'] == 'none-found')}")
    by = {}
    for r in rows:
        by[r["source"] or "(none)"] = by.get(r["source"] or "(none)", 0) + 1
    for k, v in sorted(by.items(), key=lambda kv: -kv[1]):
        print(f"    {k:<22} {v}")
    for f_ in ("caution", "stand-in", "not-patreon-exclusive"):
        n = sum(1 for r in rows if r["flag"] == f_)
        if n:
            print(f"  flagged {f_}: {n}")
    print(f"→ {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
