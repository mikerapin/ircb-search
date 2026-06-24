# IRCB Search

Episode and comic search tool for [I Read Comic Books](https://ircbpodcast.simplecast.com) — a weekly podcast covering 794+ episodes of comic book discussion.

Live at **[mikerapin.github.io/ircb-search/](https://mikerapin.github.io/ircb-search/)**

## What it does

- Search comic titles, topics, keywords, episode titles, and **show notes** across the full episode archive
- Comic series are grouped automatically ("Batman" unifies all individual issues)
- Filter by panelist, guest episodes, or search mode (All / Comics Only / Topics Only)
- Click trending chips to explore the most-discussed comics of all time or the past 12 months
- Play episodes inline via the embedded Simplecast player
- Expand show notes to read episode summaries and discover **related episodes**
- Browse panelist pages with their episode history and most-discussed comics

## Dev

```bash
npm install
npm run dev        # serves at http://localhost:3000
npm test           # Playwright tests (77 tests, Chromium)
```

## Update data

Data is exported from [sshugars/ircb](https://github.com/sshugars/ircb) via a Python script:

```bash
npm run export     # runs export_data.py → data/comics.json + data/episodes.json
```

Or trigger the GitHub Actions workflow manually (`workflow_dispatch` on `update-data.yml`). It runs automatically every Thursday at 3am UTC after the Wednesday episode drops.

## Deploy

Static site — no build step. GitHub Actions pushes updated data files; GitHub Pages serves `index.html` directly from `main`.
