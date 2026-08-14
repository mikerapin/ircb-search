import type { CoreData, Stats } from "./data/types";
import { newestNumbered } from "./data/numbering";
import { esc, nf } from "./lib/html";
import { href, parseHash } from "./router";

/* The chrome itself is static markup in index.html — it costs no JS and paints before the
   data lands. This module owns the parts that depend on state: the Contents menu, the
   dress label, and the keyboard/dismiss behaviour. */

const el = <T extends HTMLElement>(id: string): T => {
  const n = document.getElementById(id);
  if (!n) throw new Error(`missing #${id}`);
  return n as T;
};

const ROUTES: Array<[path: string, label: string, sub: (s: Stats) => string]> = [
  ["/search", "Episodes &amp; search", () => "Search"],
  ["/panel", "The Panel", () => "Panelists &amp; guests"],
  ["/index", "The Index", s => "All " + nf(s.series) + " series"],
  ["/wall", "The Wall", s => "All " + nf(s.episodes) + " episodes"],
  ["/about", "About the Data", () => "What is indexed"],
  ["/subscribe", "Subscribe", () => "&amp; Patreon"],
];

const NEG_KEY = "ircb.neg";

let wired = false;

function closeMenu(): void {
  /* .menu[hidden] is display:none, which blurs whatever inside it had focus and strands
     the user on <body>. Hand focus back to the button that opened it first. */
  const menu = el("menu");
  if (!menu.hidden && menu.contains(document.activeElement)) el("navbtn").focus();
  menu.hidden = true;
  el("navbtn").setAttribute("aria-expanded", "false");
}

function buildMenu(stats: Stats): void {
  const here = "/" + (parseHash(location.hash).seg[0] ?? "");
  el("menu").innerHTML =
    '<div class="mh">Contents</div>' +
    `<a href="${href("/")}" class="${here === "/" ? "on" : ""}">The Cover<span class="sub">Home</span></a>` +
    ROUTES.map(([path, label, sub]) =>
      `<a href="${href(path)}" class="${here === path ? "on" : ""}">${label}<span class="sub">${sub(stats)}</span></a>`
    ).join("");
}

/**
 * Wires the chrome that does not depend on data. Called at module scope, not from
 * renderShell: everything here is reachable from the first frame, and waiting on core()
 * left the negative toggle inert and the skip link following its own href into the router.
 */
export function initChrome(): void {
  if (wired) return;
  const menu = el("menu"), navbtn = el("navbtn"), neg = el("neg"), view = el("view");

  navbtn.addEventListener("click", ev => {
    ev.stopPropagation();
    const open = menu.hidden;
    menu.hidden = !open;
    navbtn.setAttribute("aria-expanded", String(open));
    if (open) menu.querySelector("a")?.focus();
  });
  menu.addEventListener("click", ev => {
    if ((ev.target as HTMLElement).closest("a")) closeMenu();
  });
  document.addEventListener("click", ev => {
    const t = ev.target as HTMLElement;
    if (!menu.hidden && !t.closest("#menu") && !t.closest("#navbtn")) closeMenu();
  });
  document.addEventListener("keydown", ev => {
    if (ev.key === "Escape" && !menu.hidden) closeMenu();
  });

  /* The plate choice follows the reader across pages and visits. index.html applies the
     stored value in the head so a returning dark-mode reader never sees a light flash. */
  neg.setAttribute("aria-pressed", String(document.documentElement.hasAttribute("data-neg")));
  neg.addEventListener("click", () => {
    const on = !document.documentElement.hasAttribute("data-neg");
    document.documentElement.toggleAttribute("data-neg", on);
    neg.setAttribute("aria-pressed", String(on));
    try { localStorage.setItem(NEG_KEY, on ? "1" : "0"); } catch { /* private mode */ }
  });

  /* The skip link targets #view, but the hash is the router. Following it literally would
     navigate to a route named "view" and repaint the page the reader is trying to reach. */
  document.querySelector<HTMLAnchorElement>('a.skip[href="#view"]')?.addEventListener("click", ev => {
    ev.preventDefault();
    view.focus();
  });

  wired = true;
}

/* The menu's "you are here" marker reads the hash directly, so this takes no `active`
   argument — call it on every route and the highlight follows. */
export function renderShell(data: CoreData): void {
  const { stats } = data;
  initChrome();
  buildMenu(stats);

  /* Phones get the newest episode here instead of the dress label. The label names the page
     the reader is already on, which is the one fact they have; a way back to this week's
     episode from anywhere in the archive is not. Desktop keeps the label — it has the room
     for both, and the number there is what tells you the archive is current. */
  const latest = el<HTMLAnchorElement>("latest");
  const newest = newestNumbered(data.episodes);
  if (newest) {
    latest.href = href("/ep/" + encodeURIComponent(newest.episode.key));
    latest.textContent = `EP. ${nf(newest.no)} →`;
    latest.setAttribute("aria-label", `Latest episode, ${newest.episode.title}`);
  }
  latest.hidden = !newest;
  el("foot-legal").innerHTML =
    "I Read Comic Books Search, a search index of the podcast <em>I Read Comic Books</em>, " +
    `published weekly since 2015 by Mike Rapin. ${nf(stats.episodes)} episodes and ` +
    `${nf(stats.mentions)} comic mentions across ${nf(stats.indexedEpisodes)} indexed ` +
    "episodes. All audio is hosted by Simplecast; artwork and episode metadata are the property " +
    "of their respective owners.";
}

let painted = false;

export function setView(html: string, dressLabel: string): void {
  const view = el("view");
  view.innerHTML = html;
  el("dressno").textContent = dressLabel;
  closeMenu();
  /* A hash route swaps the whole view out from under the element that had focus, which
     drops it to <body>: a screen reader announces nothing and the new page's heading is
     never read. #view carries tabindex="-1" for exactly this. Not on first paint — there
     focus belongs at the top of the document, where the skip link is. */
  if (painted) view.focus({ preventScroll: true });
  painted = true;
  window.scrollTo(0, 0);
}

export function setSearchBox(value: string): void {
  el<HTMLInputElement>("q").value = value;
}

/** Escape hatch for views that need to render an error without knowing the dress. */
export function fail(message: string): string {
  return `<section class="sec"><div class="sec-head"><h2 class="disp">${esc(message)}</h2></div></section>`;
}
