# IRCB Search

A search index for [I Read Comic Books](https://ircbpodcast.com): every comic the show has
named, every episode that named it, and the minute it came up.

Live at **[search.ircbpodcast.com](https://search.ircbpodcast.com)**.

## Features

- Search comics, episode titles, show notes, keywords, and panelists at once, with typeahead.
- Results are grouped by episode: one card per episode, listing the comics that matched.
- **Jump Cut** plays an episode from a logged minute, in the page. A mini-bar keeps playback
  going across navigation, and the OS lock screen shows what's playing.
- **The Wall** shows the whole run as a grid, one square per dated episode, shaded by how many
  comics were logged. Search highlights it; a panelist filters it.
- Read-alongs, series runs and checklists, panelist pages, an A–Z index, and a panel directory.
- Light and negative color themes, remembered across visits.

## Development

```bash
npm install
npm run dev          # Vite dev server
npm run check        # tsc --noEmit; must pass before every commit
npm run test:unit    # Vitest
npm test             # Playwright (Chromium), on port 5183
npm run build        # check + build-data.mjs + vite build → dist/
npm run preview      # serve the built bundle
```

Judge these by exit code: `rtk` can print a reassuring summary for a command that failed.

## Architecture

Vite and strict TypeScript, no framework. Views are functions that return HTML strings, and a
hash router swaps them into `#view`.

| Path | Responsibility |
|------|----------------|
| `src/main.ts`   | Route table, boot, page chrome |
| `src/router.ts` | Hash routing and link building |
| `src/shell.ts`  | Persistent header, menu, and view swap |
| `src/data/`     | Loading, shaping, types, the panelist roster |
| `src/search/`   | Fuse.js ranking, grouping, typeahead |
| `src/views/`    | One module per route, plus shared components |
| `src/audio/`    | The single `<audio>` element, segments, Media Session |
| `src/style/`    | `tokens.css` (both themes) and `dress.css` |

Data is split per route. `core.json` loads with the first paint; `mentions.json`,
`detail.json`, and `index.json` load only when a route needs them. Loaders cache successful
requests, never failures.

Two rules, both enforced by tests:

- Fade small text with `color-mix`, never `opacity`. Opacity doesn't change the computed
  color, so contrast checks would read it at full strength. `tests/contrast.spec.ts` checks
  hover and focus in both themes.
- Don't quote data counts in comments or copy; they go stale. `scripts/series-report.mjs`
  prints the current ones.

## Audio

Playback uses a native `<audio>` element pointed at the published enclosure. The show's
download stats (Blubrry) depend on these rules, asserted in `tests/audio.spec.ts`:

- No `autoplay` attribute; playback starts only from a user gesture.
- `preload="none"`, so a page visit doesn't count as a download.
- Seek with `currentTime`; never add a parameter to the enclosure URL.
- Never proxy or rehost the media.

The audio tests play generated silence, so test runs don't add to the download counts.

## Data updates

Public episodes and comics come from [sshugars/ircb](https://github.com/sshugars/ircb).
Patreon-only episodes come from the IRCB Secret Feed.

```bash
npm run export           # export_data.py → data/comics.json + data/episodes.json
npm run export:patreon   # fetch_patreon.py → data/patreon.json
npm run build            # → public/d/*.json, the chunks the app loads
```

The upstream tables come from a cron job that sometimes skips a week. To cover that,
`export_data.py` also adds any RSS episode the table doesn't have yet, keyed by its RSS guid,
the same ID the table uses once it catches up. Those episodes take their comics from the show
notes.

`update-data.yml` runs Wednesday 17:00 UTC, an hour after the upstream job, and Thursday
03:00 UTC as a backstop. It commits the result and then dispatches `deploy.yml`. The dispatch
is required, because pushes made with `GITHUB_TOKEN` don't trigger `on: push` workflows.

### Tags

`src/data/tags.ts` classifies every `<itunes:keywords>` term (`series`, `publisher`,
`creator`, `topic`, and a few show-specific kinds) during the build.

- `data/tag-seeds.json` is the curated input. Fix a wrong classification there. When the build
  prints a term that looks like a comic nobody logged, add it to the seeds' `comics` list.
- `data/tag-taxonomy.json` is an output, rewritten on every build for review. Nothing reads it.
- `series` terms add mentions (`segment: "Tagged"`, no minute), but only to runs the index
  already has, and never on top of a logged mention of the same book.

Tags record what an episode was filed under, not everything it discussed, so they aren't a
complete index. That's why there are no `/publisher` or `/creator` pages. Tags appear as chips
on the episode page, linking to a series page when one exists and to a search otherwise.

### Episode numbers

`EP.` numbers come from `data/episode-numbers.csv`, which `scripts/schedule_numbers.py`
generates from the private IRCB Schedule workbook. The workbook is the only source: the feed
has no `itunes:episode` tag, titles stopped carrying numbers in January 2024, and some episodes
take no number.

**Refresh.** The update job reads the workbook through an Apps Script web app,
`scripts/schedule-webapp.gs`, which includes its own deploy steps. The `SCHEDULE_WEBAPP_URL`
secret holds its URL and token; without the secret, the step is skipped and the committed CSV
stays. To refresh by hand, download the workbook from Drive as .xlsx (the native export drops
rows) and run:

```bash
python scripts/schedule_numbers.py ~/Downloads/schedule.xlsx
```

**Workbook layout.** Columns are found by header name. The **Old Recording Dates** and
**Schedule** tabs both need `Ep` and `Rec. Date` in row 1; `Topic` and `Release` are optional.
If you rename a header, update `TABS` in both scripts, then redeploy the web app: **Deploy** >
**Manage deployments**, edit the deployment, and choose **New version**. That keeps the URL, so
the secret doesn't change.

**Matching.**

- Rows with a `Release` date (EP. 532 onward) match the episode that aired on that date.
  Release is the planned date, so move it when an episode slips. If a Release date passes with
  no episode on it, the script stops and names the row.
- Older rows match on recording date: each episode takes the newest unclaimed row recorded up
  to 14 days before it aired. An undated row counts seven days after the row above it, and a
  fractional `Ep` such as `475.1` marks a skipped week.
- A number in the episode's own RSS title always wins.

After changing the matching rules, run `python scripts/schedule_numbers.py --selfcheck`.

**Alerts.** If the refresh fails, the job logs a warning and keeps the committed CSV.
`export_data.py --check-numbers` then fails the job once two or more episodes have aired since
the CSV's newest row. One is normal, so a broken refresh can go a week before the job fails.

### Patreon episodes

`fetch_patreon.py` reads `PATREON_RSS_URL` from the environment, a gitignored `.env`, or a CI
secret. The URL is per-patron, so treat it as a credential.

Most feed items mirror public episodes, which already come from Simplecast, so only
Patreon-only episodes are kept.

**The `<enclosure>` URL never ships.** It carries a per-patron signature
(`/api/rss/u/<token>/e/<id>.mp3?sig=…`). Only `<link>`, the public Patreon post page, is
published. `tests/unit/patreon.test.ts` checks the built output for both.

Comics are attached by the first of these rules that applies:

1. `data/patreon-no-comic.json`: episodes with no comic, such as trailers, Q&As, film
   episodes, and the Candybar Antlerboy run.
2. `data/patreon-comics.json`: hand-checked overrides.
3. The read-along's subject.
4. The monthly Goodreads pick, named after a colon in the title.
5. The two books in an `X vs Y` title.

An episode that matches no rule is kept with no mentions. Post-credits segments link to their
episode through `parentKey` and carry no mentions of their own.

`data/patreon-series.json` picks which runs the home page promotes. Their episode counts and
fallback links are computed at build time, and a run with no collection page links to its
newest post. `tests/unit/patreon.test.ts` fails when a large run is missing from that file.

## Deploy

`deploy.yml` builds on every push to `main` and publishes `dist/` to GitHub Pages. It first
checks that `dist/CNAME` and `dist/d/core.json` exist. `CNAME` lives in `public/`, because an
artifact deploy doesn't include repo-root files, and without it the custom domain is lost.
