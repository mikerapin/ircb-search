import { core, mentions as loadMentions } from "../data/load";
import { ROSTER, panelistNames } from "../data/roster";
import type { CoreData, EpisodeCore, Mention } from "../data/types";
import { esc, fmtDate, fmtRuntime, nf, pl } from "../lib/html";
import { href } from "../router";
import { feedNumbers } from "../data/numbering";
import { readAlong } from "./readalong";

/**
 * The Wall — the whole run as one grid, a square per dated episode.
 *
 * Ink coverage, not a heat map: a busier episode is a darker square, so the page reads as a
 * printed tint chart. Undated records have no square at all, because the grid is a calendar
 * and there is nowhere honest to put them; the legend says how many and why.
 *
 * First paint is core.json only. `mentionCount` is folded in at build time, so the grid needs
 * nothing else. The mention list arrives in a second pass for the parts that genuinely need
 * it — igniting the wall by comic, the series rack, and the detail rail.
 */

/** Buckets chosen off the real distribution, not invented. `ramp(0)` is its own state. */
function ramp(n: number): number {
  return !n ? 0 : n < 5 ? 1 : n < 9 ? 2 : n < 13 ? 3 : 4;
}

interface YearRow { year: string; eps: EpisodeCore[] }

function yearRows(episodes: EpisodeCore[]): YearRow[] {
  const by = new Map<string, EpisodeCore[]>();
  for (const e of episodes) {
    if (!e.date) continue;
    const y = e.date.slice(0, 4);
    let row = by.get(y);
    if (!row) by.set(y, (row = []));
    row.push(e);
  }
  for (const row of by.values()) row.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  /* Newest year at the top — Mike's call, and it is how anyone reads an archive. Within a
     row the episodes still run oldest to newest, so each year reads left to right the way a
     year does; only the stack of years is reversed. */
  return [...by.keys()].sort().reverse().map(year => ({ year, eps: by.get(year) ?? [] }));
}

function cell(e: EpisodeCore): string {
  const when = fmtDate(e.date);
  const title = e.title || "Untitled episode";
  const what = e.mentionCount ? `${e.mentionCount} comic${pl(e.mentionCount)} discussed` : "comics not logged";
  const who = e.people.length ? ` Panel: ${e.people.join(", ")}.` : "";
  return `<button class="cell n${ramp(e.mentionCount)}" type="button" data-cell="${esc(e.key)}"` +
    ` title="${esc(`${when} — ${title}`)}"` +
    ` aria-label="${esc(`${when}. ${title}. ${what}.${who}`)}"></button>`;
}

/** Shared with the panelist mini-wall, which passes `only`. */
export function wallGrid(episodes: EpisodeCore[], opts?: { only?: Set<string>; mini?: boolean }): string {
  const rows = yearRows(episodes);
  /* One column per episode, capped, so a busy year wraps onto a second and third line
     instead of stretching every row thinner.

     The grid was built when a year meant the public feed — 63 episodes at the very most,
     which is why 63 is the stylesheet's own fallback. Folding in the Patreon shelf took 2020
     to 135, and because the track count is the busiest year every other row was drawn at half
     the cell size and left trailing off into whitespace. The narrow breakpoint has always
     capped at 13 and wrapped; this is the same idea at the width where it was never needed
     before. Column N is still week N of that year, so the years still line up. */
  const WEEKS = 63;
  const cols = Math.min(WEEKS, rows.reduce((m, r) => Math.max(m, r.eps.length), 1));
  const only = opts?.only;
  const undated = episodes.filter(e => !e.date).length;

  const body = rows.map(r => {
    const eps = only ? r.eps.filter(e => only.has(e.key)) : r.eps;
    if (only && !eps.length) return "";
    return `<div class="yrow"><div class="ylab">${r.year}` +
      `<span class="cnt">${eps.length}${only ? "" : ` ep${pl(eps.length)}`}</span></div>` +
      `<div class="ycells">${eps.map(cell).join("")}</div></div>`;
  }).join("");

  /* Since the Patreon feed replaced the undated shelf every episode has an air date, so this
     note would read "0 episodes carry no air date" — a sentence about something that does not
     happen. Say it only when there is something to say. */
  const missing = undated === 0 ? "" :
    `<span style="margin-left:auto">${nf(undated)} episode${pl(undated)} carry no air date, so they have ` +
    `no square here. They&rsquo;re all still in <a href="${href("/search")}">search</a>.</span>`;

  const legend = opts?.mini ? "" :
    `<div class="walllegend"><span><i class="s0"></i>Not logged</span>` +
    `<span><i class="s2"></i>Some comics</span><span><i class="s4"></i>A full pull list</span>` +
    `<span><i class="sh"></i>Matches your search</span>${missing}</div>`;

  return `<div class="${opts?.mini ? "wall mini" : "wall"}" id="wall" style="--cols:${cols}">${body}${legend}</div>`;
}

export async function viewWall(qs: URLSearchParams): Promise<{ html: string; after: () => void }> {
  const data = await core();
  const q = qs.get("q") ?? "";
  const who = qs.get("who") ?? "";
  const target = qs.get("e") ?? "";

  const html =
    `<div class="pagehead"><div class="eyebrow">The whole run at once</div><h1 class="disp">The Wall</h1>
      <p>All ${nf(data.stats.episodes)} of our episodes as squares. Search and see the distribution of a topic or comic.
       Filter by panelist. Click a square to play an episode right on this page.</p></div>` +

    `<section class="sec"><div class="wallwrap">
      <div class="wallctl">
        <div class="ignite"><input id="ignite" type="search" autocomplete="off" spellcheck="false"
          placeholder="Light up the wall — saga, batman, a panelist…" value="${esc(q)}"
          aria-label="Search the wall"><button class="x" type="button" data-act="wclear">Clear</button></div>
      </div>
      <div class="ribbon" role="group" aria-label="Filter the wall by panelist">${ROSTER.map(p =>
      `<button class="pface" type="button" data-act="wwho" data-who="${esc(p.name)}"` +
      ` aria-pressed="${who === p.name}" title="${esc(p.tagline)}">` +
      `<img src="${esc(p.photo)}" alt="" loading="lazy"><span>${esc(p.display.split(" ")[0] ?? p.display)}</span></button>`
    ).join("")}</div>
      <div class="wrack" id="wrack" style="margin:12px 0 16px"></div>
      <div class="resline" id="resline"></div>` +
    wallGrid(data.episodes) +
    `</div></section>`;

  return { html, after: () => wire(data, { q, who, target }) };
}

/* ---------------------------------------------------------------------------------------
   Everything below runs after paint. The grid is already on screen at this point; none of
   it blocks on the mention list.
   --------------------------------------------------------------------------------------- */

interface WallState { q: string; who: string; target: string }

function wire(data: CoreData, state: WallState): void {
  const view = document.getElementById("view");
  if (!view) return;
  const byKey = new Map(data.episodes.map(e => [e.key, e]));
  const gap = { episodes: data.stats.episodes, indexed: data.stats.indexedEpisodes };
  let men: Mention[] | null = null;

  const grid = view.querySelector<HTMLElement>("#wall");
  const resline = view.querySelector<HTMLElement>("#resline");
  const input = view.querySelector<HTMLInputElement>("#ignite");

  /** Which episodes a query lights. Panelist filter needs no mentions; text does. */
  const matches = (q: string, whoName: string): Set<string> | null => {
    const lit = new Set<string>();
    const term = q.trim().toLowerCase();
    if (!term && !whoName) return null;

    const names = whoName ? new Set(panelistNames(whoName)) : null;
    const onPanel = (e: EpisodeCore): boolean => !names || e.people.some(p => names.has(p));

    if (!term) {
      for (const e of data.episodes) if (onPanel(e)) lit.add(e.key);
      return lit;
    }
    // A term can name a comic or a person. Both are honoured.
    for (const e of data.episodes) {
      if (!onPanel(e)) continue;
      if (e.title.toLowerCase().includes(term) || e.people.some(p => p.toLowerCase().includes(term))) lit.add(e.key);
    }
    if (men) {
      for (const m of men) {
        if (lit.has(m.epKey)) continue;
        const e = byKey.get(m.epKey);
        if (!e || !onPanel(e)) continue;
        if (m.comic.toLowerCase().includes(term) || m.series.toLowerCase().includes(term)) lit.add(m.epKey);
      }
    }
    return lit;
  };

  const paint = (): void => {
    if (!grid || !resline) return;
    const lit = matches(state.q, state.who);
    grid.classList.toggle("lit", lit !== null);
    let hits = 0;
    for (const c of grid.querySelectorAll<HTMLElement>(".cell")) {
      const on = !lit || lit.has(c.dataset["key"] ?? c.dataset["cell"] ?? "");
      c.classList.toggle("hit", lit !== null && on);
      if (lit !== null && on) hits++;
    }
    const label = state.q || state.who;
    resline.innerHTML = lit === null
      ? `<div class="m">${nf(grid.querySelectorAll(".cell").length)} episodes on the wall</div>` +
        /* "Every square opens that episode" described what a link does. Cut for the same
           reason the Spinner Rack's second line went. */
        `<div class="s">Search or pick a panelist to light it up.</div>`
      : `<div class="m"><span class="lit">${nf(hits)}</span> episode${pl(hits)} match ${esc(label)}</div>` +
        `<div class="s">${men ? "Searched titles, panels and every logged comic." : "Searching titles and panels — the comic index is still loading."}</div>`;
  };

  // The rack and comic-level search both need the mention list. Fetch it once, after paint.
  void loadMentions().then(list => {
    men = list;
    const rack = view.querySelector<HTMLElement>("#wrack");
    if (rack) {
      const tally = new Map<string, Set<string>>();
      for (const m of list) {
        let eps = tally.get(m.series);
        if (!eps) tally.set(m.series, (eps = new Set()));
        eps.add(m.epKey);
      }
      /* The number on a chip is what clicking it lights, not how many episodes carry that
         exact series. Clicking runs the text search, and "Saga" also matches "Saga:
         Compendium One" — so counting the series alone promised 15 and delivered 21. */
      rack.innerHTML = [...tally].sort((a, b) => b[1].size - a[1].size).slice(0, 16)
        .map(([name]) => {
          const lights = matches(name, "")?.size ?? 0;
          return `<button class="wchip" type="button" data-act="wq" data-q="${esc(name)}"` +
            ` aria-pressed="${state.q.toLowerCase() === name.toLowerCase()}">${esc(name)}<b>${nf(lights)}</b></button>`;
        }).join("");
    }
    paint();
  }).catch(() => { /* the wall still works on titles and panels */ });

  paint();

  /* One delegated listener on the view. Cells are re-read from the DOM rather than held,
     since a repaint replaces them. */
  view.addEventListener("click", ev => {
    const t = ev.target as HTMLElement;
    const c = t.closest<HTMLElement>(".cell");
    if (c) { openRail(c.dataset["cell"] ?? "", byKey, () => men, gap, state); return; }
    const hit = t.closest<HTMLElement>("[data-act]");
    if (!hit) return;
    const act = hit.dataset["act"];
    if (act === "wclear") { state.q = ""; state.who = ""; if (input) input.value = ""; syncPressed(view, state); paint(); }
    else if (act === "wq") { state.q = hit.dataset["q"] ?? ""; if (input) input.value = state.q; syncPressed(view, state); paint(); }
    else if (act === "wwho") {
      const name = hit.dataset["who"] ?? "";
      state.who = state.who === name ? "" : name;
      syncPressed(view, state);
      paint();
    }
  });

  input?.addEventListener("input", () => { state.q = input.value; syncPressed(view, state); paint(); });

  if (state.target) arrive(state.target, byKey, () => men, gap);
}

function syncPressed(view: HTMLElement, state: WallState): void {
  for (const b of view.querySelectorAll<HTMLElement>("[data-act=wwho]"))
    b.setAttribute("aria-pressed", String(b.dataset["who"] === state.who));
  for (const b of view.querySelectorAll<HTMLElement>("[data-act=wq]"))
    b.setAttribute("aria-pressed", String((b.dataset["q"] ?? "").toLowerCase() === state.q.toLowerCase()));
}

/** `?e=` — centre the square and fire the one-time arrival cue. */
function arrive(
  key: string,
  byKey: Map<string, EpisodeCore>,
  men: () => Mention[] | null,
  gap: { episodes: number; indexed: number },
): void {
  const c = document.querySelector<HTMLElement>(`.cell[data-cell="${CSS.escape(key)}"]`);
  if (!c) return;
  c.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
  c.classList.add("spot", "current");
  // One-time: the swirl plays once and the steady outline takes over.
  c.addEventListener("animationend", () => c.classList.remove("spot"), { once: true });
  openRail(key, byKey, men, gap);
}

/* ---------------------------------------------------------------------------------------
   The rail. It lives in the shell, so opening it never re-renders the grid underneath.
   --------------------------------------------------------------------------------------- */

function openRail(
  key: string,
  byKey: Map<string, EpisodeCore>,
  men: () => Mention[] | null,
  gap: { episodes: number; indexed: number },
  /* What lit the square the reader just clicked. The wall says an episode matched; without
     this the rail then showed a list of twenty comics with no sign of which one it was, or a
     panel line with no sign of which name. */
  focus?: { q: string; who: string },
): void {
  const rail = document.getElementById("rail");
  const body = document.getElementById("railbody");
  const label = document.getElementById("railk");
  const scrim = document.getElementById("scrim");
  const e = byKey.get(key);
  if (!rail || !body || !e) return;

  const list = men();
  const mine = list ? list.filter(m => m.epKey === key) : [];
  /* The number first: it is what the show calls this episode, and the rail was the one place
     you could open an episode without being told which one it is. Episodes with no number —
     the pre-feed catalogue and the Patreon shelf — just get the date, as before. */
  const no = feedNumbers([...byKey.values()]).get(e.key);
  if (label) {
    label.textContent = [no ? `EP. ${nf(no)}` : "", e.date ? fmtDate(e.date) : "Undated"]
      .filter(Boolean).join(" · ");
  }

  const epLink = href("/ep/" + encodeURIComponent(e.key));
  /* The rail has always read the runtime as text rather than as a badge on the cover, and
     everywhere else now does the same. It used to be a `position:absolute` box pinned to the
     artwork; here there was no artwork to pin to, so it resolved against #rail itself and
     landed on the close button, swallowing every click on it. */
  const runtime = fmtRuntime(e.runtimeSecs);
  /* A panelist filter names someone exactly; a text query can also land on a person, since
     the wall's search reads titles, panels and comics alike. Either way the name that did it
     gets marked rather than left for the reader to find. */
  const term = (focus?.q ?? "").trim().toLowerCase();
  const markName = (name: string): string =>
    (focus?.who && name === focus.who) || (term && name.toLowerCase().includes(term))
      ? `<mark>${esc(name)}</mark>` : esc(name);
  body.innerHTML =
    `<h2 class="disp" style="margin:0"><a href="${epLink}">${esc(e.title || "Untitled episode")}</a></h2>
     <div class="credits">${e.people.map(markName).join(" · ")}</div>
     ${runtime ? `<div class="micro raildur">${esc(runtime)}</div>` : ""}
     ${list === null
        ? `<p class="lead">Loading the comics for this one…</p>`
        : readAlong(mine, byKey, gap, { mode: "list", withDate: false })}
     <p style="margin:0"><a href="${epLink}">Open the full episode →</a></p>`;

  /* After the innerHTML, not woven into readAlong: which row matched is a fact about this
     rail's own query and nothing the read-along should have to carry through three callers. */
  if (term) {
    for (const row of body.querySelectorAll<HTMLElement>(".rawrap")) {
      const hit = [...row.querySelectorAll(".cm")]
        .some(c => (c.textContent ?? "").toLowerCase().includes(term));
      row.classList.toggle("qhit", hit);
    }
  }

  rail.hidden = false;
  if (scrim) scrim.hidden = false;
  document.body.classList.add("rail-open");
  lockPage();
  document.getElementById("rail-x")?.focus();
}

/**
 * Below the desktop breakpoint the rail is a bottom sheet over the whole viewport, and the
 * page behind it used to keep scrolling — the scrim covered the wall but did not hold it
 * still. Above the breakpoint the rail is deliberately non-modal and the wall MUST stay
 * scrollable, or the squares it overlays become unreachable; hence the media query rather
 * than an unconditional lock.
 *
 * The offset is pinned rather than just hiding overflow: a non-scrollable <body> has its
 * scroll position clamped, so plain `overflow:hidden` jumped the wall on open and lost the
 * reader's place. Restored exactly on close.
 */
const SHEET = "(max-width: 999px)";
let lockedAt: number | null = null;

function lockPage(): void {
  if (lockedAt !== null || !window.matchMedia(SHEET).matches) return;
  lockedAt = window.scrollY;
  document.body.style.top = `-${lockedAt}px`;
  document.body.classList.add("rail-locked");
}

function unlockPage(): void {
  if (lockedAt === null) return;
  const y = lockedAt;
  lockedAt = null;
  document.body.classList.remove("rail-locked");
  document.body.style.top = "";
  /* Force layout before restoring. While <body> is position:fixed it is out of flow and the
     document has no height to scroll through, so a scrollTo issued in the same task lands at
     0 and the reader is thrown to the top of the wall on close. Reading offsetHeight flushes
     the reflow that gives the page its height back. */
  void document.body.offsetHeight;
  /* Instant, against the global `scroll-behavior:smooth` — the same trap the A–Z jump hit.
     A restore that animates is a restore the reader watches slide, and anything reading the
     position straight after gets a number from the middle of the animation. */
  window.scrollTo({ top: y, behavior: "instant" });
}

export function initRail(): void {
  const rail = document.getElementById("rail");
  const scrim = document.getElementById("scrim");
  const close = (): void => {
    /* Hiding a container that holds focus strands the reader on <body> — the same trap
       closeMenu() and the mini-bar both guard against. Hand focus back to the page. */
    if (rail?.contains(document.activeElement)) document.getElementById("view")?.focus({ preventScroll: true });
    if (rail) rail.hidden = true;
    if (scrim) scrim.hidden = true;
    document.body.classList.remove("rail-open");
    unlockPage();
  };
  document.getElementById("rail-x")?.addEventListener("click", close);
  scrim?.addEventListener("click", close);
  document.addEventListener("keydown", ev => {
    if (ev.key === "Escape" && !rail?.hidden) close();
  });
  window.addEventListener("hashchange", close);
}
