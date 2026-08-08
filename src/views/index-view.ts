import { core, mentions as loadMentions } from "../data/load";
import { seriesRows, type SeriesRow } from "../data/series-index";
import { esc, nf, pl } from "../lib/html";
import { href } from "../router";

interface Bucket { letter: string; rows: SeriesRow[] }

function azBuckets(rows: SeriesRow[]): Bucket[] {
  const by = new Map<string, SeriesRow[]>();
  for (const r of rows) {
    let ch = (r.name.match(/[A-Za-z0-9]/)?.[0] ?? "#").toUpperCase();
    if (/[0-9]/.test(ch)) ch = "#";
    let list = by.get(ch);
    if (!list) by.set(ch, (list = []));
    list.push(r);
  }
  for (const list of by.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  return [...by.keys()].sort().map(letter => ({ letter, rows: by.get(letter) ?? [] }));
}

export async function viewIndex(): Promise<{ html: string; after: () => void }> {
  const data = await core();
  const men = await loadMentions();
  const buckets = azBuckets(seriesRows(men));
  const s = data.stats;

  const html =
    `<div class="pagehead"><div class="eyebrow">Back of the book</div><h1 class="disp">The Index</h1>
      <p>Every series the show has ever named, A to Z — how many times it came up, and in how many episodes.</p>
      <div class="statline" style="max-width:none"><b>${nf(s.series)}</b> series · <b>${nf(s.mentions)}</b> mentions · ` +
        `<b>${nf(s.uniqueComics)}</b> distinct item strings · <a href="${href("/about")}">how the names were normalized →</a></div></div>` +
    /* The hash is the router, so a fragment link here would navigate instead of scrolling.
       Buttons say what they do and keep the route intact. */
    `<div class="azbar">${buckets.map(b =>
      `<button type="button" data-jump="az-${b.letter}" aria-label="Jump to ${b.letter}">${b.letter}</button>`).join("")}</div>` +
    `<div class="azgrid">${buckets.map(b =>
      `<div class="azsec"><h2 id="az-${b.letter}">${b.letter}<span>${nf(b.rows.length)}</span></h2>` +
        b.rows.map(r =>
          `<a class="azrow" href="${href("/series/" + encodeURIComponent(r.name))}">` +
            `<span class="nm">${esc(r.name)}</span>` +
            `<span class="n" title="${r.mentions} mention${pl(r.mentions)} in ${r.episodes} episode${pl(r.episodes)}">${nf(r.mentions)}</span></a>`).join("") +
      `</div>`).join("")}</div>`;

  const after = (): void => {
    for (const btn of document.querySelectorAll<HTMLButtonElement>(".azbar [data-jump]")) {
      btn.addEventListener("click", () => {
        document.getElementById(btn.dataset["jump"] ?? "")?.scrollIntoView({ block: "start" });
      });
    }
  };

  return { html, after };
}
