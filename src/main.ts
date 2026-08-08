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

import { core } from "./data/load";
import { esc, nf } from "./lib/html";
import { go, onRoute, type Route } from "./router";
import { fail, initChrome, renderShell, setSearchBox, setView } from "./shell";
import { fitPlates } from "./views/cover";
import { viewEpisode } from "./views/episode";
import { viewHome } from "./views/home";
import { viewSearch } from "./views/search";
import { viewIndex } from "./views/index-view";
import { viewSeries } from "./views/series";
import { initTypeahead } from "./search/typeahead";
import type { CoreData } from "./data/types";

/** Placeholder for routes whose real view lands in a later plan. */
function stub(title: string, note: string): string {
  return `<section class="sec">
    <div class="pagehead"><span class="eyebrow">${esc(note)}</span><h1 class="disp">${esc(title)}</h1></div>
  </section>`;
}

type ViewResult = [html: string, label: string, after?: () => void];

async function view(r: Route, data: CoreData): Promise<ViewResult> {
  const [head, rest] = [r.seg[0], r.seg[1] ?? ""];
  switch (head) {
    case "search": return [await viewSearch(r.qs), "The Page"];
    case "ep": {
      const v = await viewEpisode(rest);
      return [v.html, "The Episode", v.after];
    }
    case "who": return [stub(rest || "Panelist", "Credits"), "Credits"];
    case "series": {
      const v = await viewSeries(rest);
      return [v.html, "The Run", v.after];
    }
    case "panel": return [stub("The Panel", "Panelists & guests"), "The Panel"];
    case "index": {
      const v = await viewIndex();
      return [v.html, "The Index", v.after];
    }
    case "about": return [stub("About the Data", "What is indexed"), "About the Data"];
    case "subscribe": return [stub("Subscribe", "& Patreon"), "Subscribe"];
    case "wall": return [stub("The Wall", `All ${nf(data.stats.episodes)} episodes`), "The Wall"];
    default: {
      const h = await viewHome();
      return [h.html, "EP. " + data.stats.episodes, h.after];
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
    });
  });
}).catch((err: unknown) => {
  setView(fail("The archive did not load. Try a refresh."), "Offline");
  console.error(err);
});
