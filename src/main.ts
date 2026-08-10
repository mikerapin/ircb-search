// Archivo needs the wdth axis (the display type runs at wdth 125/112) and Shantell needs
// its full axis set (.hand sets BNCE/INFM) — the default index.css of each ships wght only.
import "@fontsource-variable/archivo/wdth.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource-variable/shantell-sans/full.css";
import "./style/tokens.css";
import "./style/dress.css";

import { initAudio } from "./audio/engine";
import { core } from "./data/load";
import { feedNumbers } from "./data/numbering";
import { viewAbout } from "./views/about";
import { nf } from "./lib/html";
import { go, href, onRoute, type Route } from "./router";
import { fail, initChrome, renderShell, setSearchBox, setView } from "./shell";
import { fitPlates } from "./views/cover";
import { viewEpisode } from "./views/episode";
import { viewHome } from "./views/home";
import { viewPanel } from "./views/panel";
import { viewPanelist } from "./views/panelist";
import { initRail, viewWall } from "./views/wall";
import { viewSearch } from "./views/search";
import { viewSubscribe } from "./views/subscribe";
import { viewIndex } from "./views/index-view";
import { viewSeries } from "./views/series";
import { initTypeahead } from "./search/typeahead";
import type { CoreData, EpisodeCore } from "./data/types";

type ViewResult = [html: string, label: string, after?: () => void];

async function view(r: Route, data: CoreData): Promise<ViewResult> {
  const [head, rest] = [r.seg[0], r.seg[1] ?? ""];
  switch (head) {
    case "search": {
      const v = await viewSearch(r.qs);
      return [v.html, "The Page", () => {
        const view = document.getElementById("view");
        if (view) v.wire(view);
      }];
    }
    case "ep": {
      const v = await viewEpisode(rest);
      return [v.html, "The Episode", v.after];
    }
    case "who": {
      const v = await viewPanelist(rest);
      return [v.html, "Credits", v.after];
    }
    case "series": {
      const v = await viewSeries(rest);
      return [v.html, "The Run", v.after];
    }
    case "panel": {
      const v = await viewPanel();
      return [v.html, "The Panel", v.after];
    }
    case "index": {
      const v = await viewIndex();
      return [v.html, "The Index", v.after];
    }
    case "about": {
      const v = await viewAbout();
      return [v.html, "About the Data", v.after];
    }
    case "subscribe": {
      const v = await viewSubscribe();
      return [v.html, "Subscribe", v.after];
    }
    case "wall": {
      const v = await viewWall(r.qs);
      return [v.html, "The Wall", v.after];
    }
    default: {
      const h = await viewHome();
      /* The newest episode's real feed number, not the record count. Many of the
         records were never numbered feed episodes. */
      const nos = feedNumbers(data.episodes);
      const newest = data.episodes.reduce<EpisodeCore | null>(
        (best, e) => (e.date && nos.has(e.key) && (!best?.date || e.date > best.date) ? e : best), null);
      const no = newest ? nos.get(newest.key) : undefined;
      return [h.html, no ? "EP. " + nf(no) : "The Cover", h.after];
    }
  }
}

/* The search band is in the static markup, so it has to work from the first frame — wiring
   it behind core() left `/` and the search box dead until the data landed. The typeahead
   loads its own chunks and falls back to static suggestions until they arrive. */
document.getElementById("sform")?.addEventListener("submit", ev => {
  ev.preventDefault();
  const q = (document.getElementById("q") as HTMLInputElement | null)?.value.trim() ?? "";
  go("/search", { q });
});
initChrome();
/* The Wall's detail rail lives in the shell, not the view, so opening it never re-renders
   the grid. Wire it at module scope for the same reason the search band is wired here:
   behind core() it would be dead until the data landed. */
initRail();
const box = document.getElementById("q");
if (box instanceof HTMLInputElement) initTypeahead(box);

/* Generated plates size their own titles to fit, so the measurement has to happen with the
   real font metrics and a settled layout — measuring once at paint time sized them against
   fallback metrics and broke long words mid-word ("FANTASTI / C FOUR"). */
export function refitPlates(root: ParentNode = document): void {
  requestAnimationFrame(() => fitPlates(root));
}
if (document.fonts) void document.fonts.ready.then(() => fitPlates(document));

/* Anything else that sticks has to sit flush under the header, and the header's height
   changes with viewport width and font loading. Hardcoding it left a strip of page
   scrolling through the gap. Measure it and let CSS read it. */
const dress = document.querySelector(".dress");
if (dress) {
  const publish = (): void =>
    document.documentElement.style.setProperty("--dress-h", Math.round(dress.getBoundingClientRect().height) + "px");
  publish();
  new ResizeObserver(publish).observe(dress);
}
let resizeTimer = 0;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => fitPlates(document), 180);
});

// The search band and `/` only work once this module has run, which is later than `load`
// on a cold start. Marks the moment the interactive handlers exist.
document.body.dataset["ready"] = "1";

core().then(data => {
  // One <audio> for the whole site; the mini-bar inherits it when navigation eats the panel.
  const byKey = new Map(data.episodes.map(e => [e.key, e]));
  initAudio(k => byKey.get(k));

  // Views load their own chunks, so a slow route must not paint over a newer one.
  let token = 0;

  onRoute(r => {
    const mine = ++token;
    setSearchBox(r.seg[0] === "search" ? (r.qs.get("q") ?? "") : "");
    void view(r, data).then(([html, label, after]) => {
      if (mine !== token) return;
      setView(html, label);
      renderShell(data.stats);
      after?.();
    }).catch((err: unknown) => {
      // A view whose lazy chunk failed must say so; without this the old page just sits
      // there and the route looks like it silently did nothing.
      if (mine !== token) return;
      setView(fail("That page didn’t load. Try again."), "Offline");
      console.error(err);
    });
  });
}).catch((err: unknown) => {
  setView(fail("The archive did not load. Try a refresh."), "Offline");
  console.error(err);
});
