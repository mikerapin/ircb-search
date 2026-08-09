import { core, details, mentions as loadMentions } from "../data/load";
import { ROSTER, isRoster } from "../data/roster";
import type { EpisodeCore, Mention } from "../data/types";
import { esc, fmtDate, nf, pl } from "../lib/html";
import { href } from "../router";
import { jumpable, runSearch, type SearchData } from "./engine";

const SUGGESTIONS = ["Saga", "Batman", "X-Men", "Ice Cream Man", "Giant Days", "Sweet Tooth"];
const BROWSE: Array<[path: string, label: string, sub: string]> = [
  ["/search", "Episodes &amp; search", "Search"],
  ["/panel", "The Panel", "Panelists &amp; guests"],
  ["/index", "The Index", "Every series"],
  ["/wall", "The Wall", "Every episode"],
  ["/about", "About the Data", "What is indexed"],
  ["/subscribe", "Subscribe", "&amp; Patreon"],
];

interface SeriesRow { name: string; mentions: number; episodes: number }

let data: SearchData | null = null;
let seriesIndex: SeriesRow[] = [];
let guests: Array<{ name: string; n: number }> = [];
let loading: Promise<void> | null = null;

function buildIndexes(d: SearchData): void {
  const byName = new Map<string, { mentions: number; eps: Set<string> }>();
  for (const m of d.mentions) {
    let row = byName.get(m.series);
    if (!row) byName.set(m.series, (row = { mentions: 0, eps: new Set() }));
    row.mentions++;
    row.eps.add(m.epKey);
  }
  seriesIndex = [...byName].map(([name, r]) => ({ name, mentions: r.mentions, episodes: r.eps.size }))
    .sort((a, b) => b.mentions - a.mentions);

  const counts = new Map<string, number>();
  for (const e of d.core.episodes) for (const p of e.people) if (!isRoster(p)) counts.set(p, (counts.get(p) ?? 0) + 1);
  guests = [...counts].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n);
}

function ensureData(onReady: () => void): void {
  if (data) { onReady(); return; }
  loading ??= Promise.all([core(), loadMentions(), details()]).then(([c, m, dt]) => {
    data = { core: c, mentions: m, details: dt };
    buildIndexes(data);
  }).catch(() => { /* the popover stays on its static suggestions */ });
  void loading.then(onReady);
}

function opt(link: string, name: string, meta: string, escapeName = true): string {
  return `<a class="ta-opt" href="${link}"><span class="nm">${escapeName ? esc(name) : name}</span>` +
    `<span class="mt">${meta}</span></a>`;
}

function starter(): string {
  return `<div class="ta-grp">Start here</div>` +
    SUGGESTIONS.map(s => opt(href("/search", { q: s }), s, "Series")).join("") +
    `<div class="ta-grp">Browse</div>` +
    BROWSE.map(([path, label, sub]) => opt(href(path), label, sub, false)).join("");
}

function results(q: string, d: SearchData): string {
  const lq = q.toLowerCase();
  let h = "";

  const ser = seriesIndex.filter(s => s.name.toLowerCase().includes(lq))
    .sort((a, b) => {
      const sa = a.name.toLowerCase().startsWith(lq) ? 0 : 1;
      const sb = b.name.toLowerCase().startsWith(lq) ? 0 : 1;
      return sa - sb || b.mentions - a.mentions;
    }).slice(0, 6);

  const eps: EpisodeCore[] = d.core.episodes
    .filter(e => e.title.toLowerCase().includes(lq))
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")).slice(0, 4);

  const pans = ROSTER.filter(p => p.name.toLowerCase().includes(lq)).slice(0, 3);
  const gs = guests.filter(g => g.name.toLowerCase().includes(lq)).slice(0, 2);

  if (ser.length) h += `<div class="ta-grp">Series</div>` + ser.map(s =>
    opt(href("/series/" + encodeURIComponent(s.name)), s.name,
      `${nf(s.mentions)} mention${pl(s.mentions)} · ${nf(s.episodes)} ep${pl(s.episodes)}`)).join("");

  if (eps.length) h += `<div class="ta-grp">Episodes</div>` + eps.map(e =>
    opt(href("/ep/" + encodeURIComponent(e.key)), e.title || "Untitled episode",
      e.date ? esc(fmtDate(e.date)) : "undated")).join("");

  if (pans.length || gs.length) h += `<div class="ta-grp">The Panel</div>` +
    pans.map(p => opt(href("/who/" + encodeURIComponent(p.name)), p.display, "Panelist")).join("") +
    gs.map(g => opt(href("/who/" + encodeURIComponent(g.name)), g.name,
      `Guest · ${nf(g.n)} episode${pl(g.n)}`)).join("");

  const res = runSearch({ q, who: null, guest: false, sort: "relevance" }, d);
  const byKey = new Map(d.core.episodes.map(e => [e.key, e]));
  const play = res.all.filter(m => jumpable(m, byKey.get(m.epKey))).length;

  h += `<div class="ta-grp">Full search</div>` +
    opt(href("/search", { q }), `All results for “${esc(q)}”`, "↵ Enter", false) +
    `<div class="ta-foot">${nf(res.mentionTotal)} mention${pl(res.mentionTotal)} match · ` +
      `${nf(play)} you can jump to · ${nf(res.episodes.length)} episode${pl(res.episodes.length)} ` +
      `match on title or notes</div>`;
  return h;
}

export function initTypeahead(input: HTMLInputElement): void {
  const ta = document.getElementById("ta");
  if (!ta) return;
  let idx = -1;

  const options = (): HTMLAnchorElement[] => [...ta.querySelectorAll<HTMLAnchorElement>(".ta-opt")];

  const close = (): void => {
    ta.hidden = true;
    idx = -1;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  };

  const paint = (): void => {
    const q = input.value.trim();
    ta.innerHTML = !q ? starter() : (data ? results(q, data) : starter());
    /* The combobox contract: #ta is a listbox, so its children are options and everything
       else (group headings, the footer count) must be presentational or AT counts them as
       choices. Ids are stamped here rather than threaded through every opt() call site. */
    let n = 0;
    for (const el of ta.children) {
      if (el.classList.contains("ta-opt")) {
        el.setAttribute("role", "option");
        el.id = "ta-opt-" + n++;
      } else {
        el.setAttribute("role", "presentation");
      }
    }
    ta.hidden = false;
    idx = -1;
    input.setAttribute("aria-expanded", "true");
    input.removeAttribute("aria-activedescendant");
    if (q && !data) ensureData(() => { if (!ta.hidden && input.value.trim()) paint(); });
  };

  const move = (d: number): void => {
    const o = options();
    if (!o.length) return;
    if (idx >= 0) { o[idx]?.classList.remove("act"); o[idx]?.setAttribute("aria-selected", "false"); }
    /* Cycle over [input, ...options]: shift by one so the input sits at 0, rotate, shift back.
       The prototype's version left -1 mapping to itself, so the first ArrowDown did nothing. */
    const span = o.length + 1;
    idx = (((idx + 1 + d) % span) + span) % span - 1;
    if (idx < 0) { input.removeAttribute("aria-activedescendant"); input.focus(); return; }
    const el = o[idx];
    if (!el) return;
    el.classList.add("act");
    el.setAttribute("aria-selected", "true");
    /* Focus stays in the input; aria-activedescendant is what tells a screen reader which
       option is current. aria-current said nothing here, and the popover had no listbox
       role for it to say it about. */
    input.setAttribute("aria-activedescendant", el.id);
    el.scrollIntoView({ block: "nearest" });
  };

  input.addEventListener("focus", () => { ensureData(() => {}); paint(); });
  input.addEventListener("input", paint);
  input.addEventListener("keydown", ev => {
    if (ta.hidden) return;
    if (ev.key === "ArrowDown") { ev.preventDefault(); move(1); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); move(-1); }
    else if (ev.key === "Enter" && idx >= 0) { ev.preventDefault(); options()[idx]?.click(); }
    // Escape dismisses the popover; it does not throw the user out of the field they are
    // typing in. blur() here sent focus to <body>.
    else if (ev.key === "Escape") { close(); }
  });
  ta.addEventListener("click", ev => { if ((ev.target as HTMLElement).closest(".ta-opt")) close(); });

  document.addEventListener("click", ev => {
    const t = ev.target as HTMLElement;
    if (!ta.hidden && !t.closest(".blurb") && !t.closest(".ta")) close();
  });
  document.addEventListener("keydown", ev => {
    if (ev.key === "Escape" && !ta.hidden) { close(); return; }
    if (ev.key === "/" && ta.hidden) {
      const tag = document.activeElement?.tagName ?? "";
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      ev.preventDefault();
      input.focus();
      input.select();
      paint();
    }
  });

  window.addEventListener("hashchange", close);
}

/** Exposed for the search view's own suggestion chips. */
export { SUGGESTIONS };
