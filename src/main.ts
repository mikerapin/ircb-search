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
import { fail, renderShell, setSearchBox, setView } from "./shell";
import type { CoreData } from "./data/types";

/** Placeholder for routes whose real view lands in a later plan. */
function stub(title: string, note: string): string {
  return `<section class="sec">
    <div class="pagehead"><span class="eyebrow">${esc(note)}</span><h1 class="disp">${esc(title)}</h1></div>
  </section>`;
}

function view(r: Route, data: CoreData): [html: string, label: string] {
  const [head, rest] = [r.seg[0], r.seg[1] ?? ""];
  switch (head) {
    case "search": return [stub("Search", "Coming in the next task"), "The Page"];
    case "ep": {
      const ep = data.episodes.find(e => e.key === rest);
      return [stub(ep?.title || "Episode not found", "Episode"), "The Episode"];
    }
    case "who": return [stub(rest || "Panelist", "Credits"), "Credits"];
    case "series": return [stub(rest || "Series", "The run"), "The Run"];
    case "panel": return [stub("The Panel", "Panelists & guests"), "The Panel"];
    case "index": return [stub("The Index", `All ${nf(data.stats.series)} series`), "The Index"];
    case "about": return [stub("About the Data", "What is indexed"), "About the Data"];
    case "subscribe": return [stub("Subscribe", "& Patreon"), "Subscribe"];
    case "wall": return [stub("The Wall", `All ${nf(data.stats.episodes)} episodes`), "The Wall"];
    default: return [stub("The Cover", "Home"), "EP. " + data.stats.episodes];
  }
}

core().then(data => {
  document.getElementById("sform")?.addEventListener("submit", ev => {
    ev.preventDefault();
    const q = (document.getElementById("q") as HTMLInputElement | null)?.value.trim() ?? "";
    go("/search", { q });
  });

  onRoute(r => {
    const [html, label] = view(r, data);
    setView(html, label);
    setSearchBox(r.seg[0] === "search" ? (r.qs.get("q") ?? "") : "");
    renderShell(data.stats);
  });
}).catch((err: unknown) => {
  setView(fail("The archive did not load. Try a refresh."), "Offline");
  console.error(err);
});
