# IRCB Search

A search index for [I Read Comic Books](https://ircbpodcast.com) — every comic the show has
named, every episode it was named in, and the minute it came up.

Live at **[search.ircbpodcast.com](https://search.ircbpodcast.com)**

## What it does

- Search comics, episode titles, show notes, keywords and panelists at once, with a typeahead
- Results lead with the **episode**: one card per matching episode, with the comics that
  matched listed inside it
- **Jump Cut** — a logged minute plays the episode from that minute, in the page. A mini-bar
  inherits playback when navigation destroys the panel, and the OS lock screen shows what is
  playing
- **The Wall** — the whole run as a grid, a square per dated episode, inked by how many comics
  were logged. Search lights it up; a panelist filters it
- Per-episode read-alongs, per-series runs and checklists, panelist pages, a full A–Z index,
  and a panel directory
- A light and a negative plate, remembered across visits

## Dev

```bash
npm install
npm run dev          # vite dev server
npm run check        # tsc --noEmit — must be green before every commit
npm run test:unit    # vitest
npm test             # Playwright (Chromium), pinned to port 5183
npm run build        # tsc --noEmit + build-data.mjs + vite build → dist/
npm run preview      # serve the built bundle
```

Judge these by exit code. `rtk` will print reassuring text for a command that exited 1.

## Architecture

Vite + TypeScript (`strict`), no framework. Views are functions returning HTML strings; a hash
router swaps them into `#view`.

| Path | Responsibility |
|------|----------------|
| `src/main.ts`      | Route table, boot, chrome wiring |
| `src/router.ts`    | Hash routing and link building |
| `src/shell.ts`     | The persistent dress — header, menu, view swap |
| `src/data/`        | Loading, shaping, types, the panelist roster |
| `src/search/`      | Fuse.js ranking, grouping, typeahead |
| `src/views/`       | One module per route, plus shared components |
| `src/audio/`       | The single `<audio>` element, segments, Media Session |
| `src/style/`       | `tokens.css` (the two plates) and `dress.css` |

**Data is chunked per route.** `core.json` rides the first paint; `mentions.json`,
`detail.json` and `index.json` are fetched only when a route needs them, and each loader
memoises the request but never a failure.

**Two rules this codebase keeps re-learning**, both enforced by tests rather than convention:

- Small text fades with `color-mix`, never element `opacity` — `opacity` does not change the
  computed colour, so a measurement reads it at full strength. `tests/contrast.spec.js` walks
  hover and focus in both plates and folds opacity in.
- Comments and copy must not quote data counts. They go stale silently; `scripts/series-report.mjs`
  prints the current ones.

## Audio, and why it is careful

Playback is native `<audio>` pointed at the published enclosure. Four rules come from
Blubrry's stats requirements and are asserted in `tests/audio.spec.js` — breaking any of them
misreports the show's downloads:

1. no `autoplay` attribute; playback only ever follows a gesture
2. `preload="none"`, so a page visit is not a download
3. seek with `currentTime` — never append a parameter to the enclosure URL
4. never proxy or rehost the media

The audio specs serve generated silence and assert on the URL requested. A suite that really
streamed the enclosure would inflate the very numbers it exists to protect.

## Update data

Source data comes from [sshugars/ircb](https://github.com/sshugars/ircb):

```bash
npm run export       # export_data.py → data/comics.json + data/episodes.json
npm run build        # → public/d/*.json, the chunks the app actually loads
```

`update-data.yml` runs the export every Thursday at 3am UTC, after the Wednesday episode
drops, and commits the result.

## Deploy

`deploy.yml` builds on push to `main` and publishes `dist/` to GitHub Pages. The job asserts
`dist/CNAME` and `dist/d/core.json` exist before publishing — an artifact deploy carries no
repo-root `CNAME`, so it lives in `public/` and the custom domain would drop without it.
