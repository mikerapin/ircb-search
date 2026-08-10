import { core, details, mentions as loadMentions } from "../data/load";
import { ROSTER_MAP, isRoster, panelistNames } from "../data/roster";
import type { EpisodeCore, Mention } from "../data/types";
import { esc, nf, pl } from "../lib/html";
import { href } from "../router";
import {
  SEARCH_CAP, groupByEpisode, runSearch,
  type EpisodeGroup, type SearchData, type SearchQuery,
} from "../search/engine";
import { byDateDesc, episodePanel } from "./components";
import { raListRow } from "./readalong";

const SUGGESTIONS = ["Saga", "Batman", "X-Men", "Ice Cream Man", "Giant Days", "Sweet Tooth"];

/* How many matched comics a card lists before it stops. Measured against the real hits: for
   anything a reader types this never fires — batman's busiest episode matched four comics,
   x-men's seven. It exists for a query like "a", where one episode matched forty-four and a
   single card would otherwise be taller than the screen. */
const CARD_ROWS = 6;

let data: SearchData | null = null;
async function searchData(): Promise<SearchData> {
  if (data) return data;
  const [c, m, d] = await Promise.all([core(), loadMentions(), details()]);
  data = { core: c, mentions: m, details: d };
  return data;
}

export function readQuery(qs: URLSearchParams): SearchQuery {
  const sort = qs.get("sort");
  return {
    q: qs.get("q") ?? "",
    who: qs.get("who") || null,
    guest: qs.get("guest") === "1",
    sort: sort === "recent" || sort === "oldest" ? sort : "relevance",
  };
}

function avatar(name: string): string {
  const p = ROSTER_MAP.get(name);
  return p ? `<img src="${esc(p.photo)}" alt="" loading="lazy">` : `<span class="ph"></span>`;
}

function facetHref(q: SearchQuery, over: Partial<SearchQuery>): string {
  const n = { ...q, ...over };
  const out: Record<string, string> = {};
  if (n.q) out["q"] = n.q;
  if (n.who) out["who"] = n.who;
  if (n.guest) out["guest"] = "1";
  if (n.sort !== "relevance") out["sort"] = n.sort;
  return href("/search", out);
}

function rail(q: SearchQuery, all: Mention[], byKey: Map<string, EpisodeCore>): string {
  const counts = new Map<string, number>();
  for (const m of all) {
    const e = byKey.get(m.epKey);
    if (!e) continue;
    for (const n of e.people) if (isRoster(n)) counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  const names = [...counts].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n);
  /* A guest is not in `counts` (that only tallies the roster), and labelling them with
     all.length gave them the whole query's total as if it were theirs. Count their own. */
  if (q.who && !counts.has(q.who)) {
    const theirs = new Set(panelistNames(q.who));
    const n = all.filter(m => byKey.get(m.epKey)?.people.some(p => theirs.has(p))).length;
    names.unshift({ name: q.who, n });
  }

  const sorts: Array<[SearchQuery["sort"], string]> = [
    ["relevance", "Best match"], ["recent", "Newest first"], ["oldest", "Oldest first"],
  ];

  return `<aside class="rail">` +
    `<div class="railbox"><div class="rh">Sort</div><div class="rb rows">` +
      sorts.map(([k, label]) =>
        `<a class="facet" href="${facetHref(q, { sort: k })}" aria-current="${q.sort === k}">${label}</a>`
      ).join("") +
    `</div></div>` +
    `<div class="railbox who"><div class="rh">Who was on mic</div><div class="rb rows">` +
      (q.who ? `<a class="facet" href="${facetHref(q, { who: null })}" aria-current="false"><span class="ph"></span>All panelists<span class="n">${nf(all.length)}</span></a>` : "") +
      names.slice(0, 12).map(o =>
        `<a class="facet" href="${facetHref(q, { who: o.name })}" aria-current="${q.who === o.name}">` +
          avatar(o.name) +
          `<span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(o.name)}</span>` +
          `<span class="n">${nf(o.n)}</span></a>`
      ).join("") +
      `<a class="facet" href="${facetHref(q, { guest: !q.guest })}" aria-current="${q.guest}"><span class="ph"></span>Guest episodes</a>` +
    `</div></div>` +
  `</aside>`;
}

/**
 * A result is an episode, not a comic.
 *
 * Mike, on the review shots: the same plate over and over reads as one repeated result when
 * it is really 75 different comics, and the thing a reader is being sent to is the episode.
 * So the episode leads — its own artwork, title, date and panel — and the comics that matched
 * are the timestamp rows inside it, each keeping the jump it already had.
 */
function episodeCard(g: EpisodeGroup): string {
  const shown = g.mentions.slice(0, CARD_ROWS);
  const rest = g.mentions.length - shown.length;
  const epLink = href("/ep/" + encodeURIComponent(g.ep.key));
  const rows = shown.map(m => raListRow(m, g.ep, null, { withDate: false })).join("") +
    (rest
      ? `<div class="rawrap"><a class="ra-row more" href="${epLink}">` +
          `<span class="t none">+${nf(rest)}</span>` +
          `<span><span class="cm">more match${rest === 1 ? "" : "es"} in this episode</span></span>` +
          `<span class="cue">Open →</span></a></div>`
      : "");
  return episodePanel(g.ep, { extra: `<div class="ra-list">${rows}</div>` });
}

/**
 * Both lists on this page dead-ended, and search was the only way on: the results stopped at
 * the cap with a line saying how many you could not see, and the newest list stopped at
 * eight. They page in place now.
 *
 * A button rather than a shareable `?n=` link, which was the tempting version: every hash
 * navigation runs `setView`, which scrolls to 0, so each "load more" would have thrown the
 * reader back to the top of the page they were reading.
 */
interface Pager { html: string; wire: (view: HTMLElement) => void }

function pager(items: string[], size: number, cls: string, noun: string): Pager {
  const rest = items.slice(size);
  const shown = items.length - rest.length;
  const html = `<div class="${cls}" data-list>${items.slice(0, size).join("")}</div>` +
    (rest.length
      ? `<div class="pager"><button class="pagemore" type="button" data-act="more">` +
        `Load ${nf(Math.min(size, rest.length))} more</button>` +
        `<span class="pagern" role="status">Showing ${nf(shown)} of ${nf(items.length)} ${noun}</span></div>`
      : "");

  const wire = (view: HTMLElement): void => {
    const list = view.querySelector<HTMLElement>("[data-list]");
    const btn = view.querySelector<HTMLButtonElement>(".pagemore");
    const count = view.querySelector<HTMLElement>(".pagern");
    if (!list || !btn || !count) return;
    let at = size;
    btn.addEventListener("click", () => {
      const next = items.slice(at, at + size);
      at += next.length;
      const before = list.children.length;
      list.insertAdjacentHTML("beforeend", next.join(""));
      const left = items.length - at;
      count.textContent = `Showing ${nf(at)} of ${nf(items.length)} ${noun}`;
      if (left) btn.textContent = `Load ${nf(Math.min(size, left))} more`;
      /* The control that had focus is about to be removed. Hand focus to the first thing
         it just added, or the reader lands on <body> with nothing announced — the same
         trap the rail close and closeMenu both guard against. */
      else {
        const first = list.children[before];
        if (first instanceof HTMLElement) { first.tabIndex = -1; first.focus({ preventScroll: true }); }
        btn.remove();
      }
    });
  };

  return { html, wire };
}

/* 12 rather than the old flat 8: it divides evenly into the 2-, 3- and 4-column grids this
   list runs at, so a page never ends on a ragged half-row. */
const NEWEST_PAGE = 12;

export async function viewSearch(qs: URLSearchParams): Promise<{ html: string; wire: (view: HTMLElement) => void }> {
  const q = readQuery(qs);
  const d = await searchData();
  const byKey = new Map(d.core.episodes.map(e => [e.key, e]));
  let page: Pager = { html: "", wire: () => { /* no list to page */ } };

  if (!q.q.trim() && !q.who && !q.guest) {
    /* Every dated episode, not just the 546 with artwork. The artwork filter predates the
       generated plate `art()` falls back to, and with paging it would have stopped the list
       106 short of the run with nothing on screen saying so. */
    const latest = d.core.episodes.filter(e => e.date).sort(byDateDesc);
    page = pager(latest.map(e => episodePanel(e)), NEWEST_PAGE, "panels", "episodes");
    return { wire: page.wire, html: `<div class="pagehead"><div class="eyebrow">Episodes &amp; search</div>` +
      `<h1 class="disp">Search the archive</h1>` +
      // Not "timestamped": most logged comics carry no minute. About the Data quotes the split.
      `<p>${nf(d.core.stats.mentions)} comic mentions across ${nf(d.core.stats.indexedEpisodes)} indexed episodes. ` +
      `Type in the yellow band above, or hit <b>/</b> from anywhere, and suggestions open as you type.</p>` +
      `<div class="chips" style="padding:0">${SUGGESTIONS.map(t =>
        `<a class="chip" href="${href("/search", { q: t })}">${esc(t)}</a>`).join("")}</div></div>` +
      `<section class="sec"><div class="sec-head"><h2 class="disp">Newest Episodes</h2>` +
        `<span class="note">The whole dated run, newest first</span></div>${page.html}</section>` };
  }

  const res = runSearch(q, d);
  /* Clear only `who` — the facet each rail link actually changes. Clearing `guest` too
     meant that with the guest filter on, every panelist count was the number you'd get
     WITHOUT it, so clicking a facet landed on a smaller result than the count promised. */
  const whoBase = runSearch({ ...q, who: null }, d);

  /* SEARCH_CAP pages cards rather than mentions, so a page is 36 episodes, not the 36
     mentions those episodes happened to contribute. `res.mentionTotal` is untouched by the
     regroup and stays the number the header reports. */
  const groups = groupByEpisode(res.all, byKey);
  /* SEARCH_CAP is the page size now, not a ceiling — every matched episode is reachable
     from the page it was found on. `carded` still has to be every one of them, or an
     episode paged into view further down would also be sitting in "Episodes About It". */
  const carded = new Set(groups.map(g => g.ep.key));
  /* Both sections render an episode panel, so an episode matched on its comics AND on its
     title would otherwise appear twice. */
  const eps = res.episodes.filter(e => !carded.has(e.key)).slice(0, 6);
  const inEps = groups.length;
  page = pager(groups.map(episodeCard), SEARCH_CAP, "panels cards", "episodes");

  const head = `<div class="crumb"><a href="${href("/")}">← The Cover</a>` +
      (q.who ? ` · <a href="${href("/who/" + encodeURIComponent(q.who))}">${esc(q.who)}</a>` : "") + `</div>` +
    `<div class="pagehead"><div class="eyebrow">Episodes &amp; search</div>` +
      `<h1 class="disp">${esc(q.q || (q.who ?? "Guest episodes"))}</h1>` +
      `<p class="honest-count">${nf(res.mentionTotal)} mention${pl(res.mentionTotal)} in ${nf(inEps)} episode${pl(inEps)}` +
      `${q.who ? `, filtered to ${esc(q.who)}` : ""}${q.guest ? ", guest episodes only" : ""}. ` +
      `${nf(res.playable)} of them you can jump straight into.</p></div>`;

  if (!res.mentionTotal && !eps.length) {
    return { wire: () => { /* nothing paged on the empty state */ },
      html: head + `<div class="empty"><b>No panel for that.</b> Nothing in the index matches. Try one of these:</div>` +
      `<div class="chips" style="padding-top:14px">${SUGGESTIONS.map(t =>
        `<a class="chip" href="${href("/search", { q: t })}">${esc(t)}</a>`).join("")}</div>` };
  }

  let results = `<div>`;
  if (groups.length) {
    results += `<section class="sec mentions"><div class="sec-head"><h2 class="disp">We Read It Here</h2>` +
      `<span class="note">Matched on the comics we logged</span></div>${page.html}</section>`;
  }
  if (eps.length) {
    results += `<section class="sec episodes"><div class="sec-head"><h2 class="disp">Episodes About It</h2>` +
      `<span class="note">Matched on title, show notes and tags</span></div>` +
      `<div class="panels">${eps.map(e => episodePanel(e)).join("")}</div></section>`;
  }
  results += `</div>`;

  return { wire: page.wire, html: head + `<div class="split">${rail(q, whoBase.all, byKey)}${results}</div>` };
}
