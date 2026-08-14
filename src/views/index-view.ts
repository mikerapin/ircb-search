import { core, seriesIndex } from "../data/load";
import { azBuckets } from "../lib/az";
import { esc, nf, pl } from "../lib/html";
import { href } from "../router";

/* Rough painted height of one bucket, used only as the placeholder size for a section the
   browser has not laid out yet. `contain-intrinsic-size: auto` replaces the guess with the
   real measurement the first time a section renders, so this only has to be close enough
   that the scrollbar does not lurch and the A–Z jump lands on its heading. Rows are one
   line at every width the design ships; long names ellipsize rather than wrap. */
const ROW_PX = 29;
const HEAD_PX = 56;

export async function viewIndex(): Promise<{ html: string; after: () => void }> {
  const [data, rows] = await Promise.all([core(), seriesIndex()]);
  const buckets = azBuckets(rows, r => r.name);
  const s = data.stats;

  const html =
    `<div class="pagehead"><div class="eyebrow">Back of the book</div><h1 class="disp">The Index</h1>
      <p>Every series we&rsquo;ve ever named on the show, A to Z, with how many times it came up and in how
      many episodes.</p>
      <div class="statline" style="max-width:none"><b>${nf(s.series)}</b> series · <b>${nf(s.mentions)}</b> mentions · ` +
        `<b>${nf(s.uniqueComics)}</b> distinct item strings · <a href="${href("/about")}">how the names were normalized →</a></div></div>` +
    /* The hash is the router, so a fragment link here would navigate instead of scrolling.
       Buttons say what they do and keep the route intact. */
    `<div class="azbar">${buckets.map(b =>
      `<button type="button" data-jump="az-${b.letter}" aria-label="Jump to ${b.letter}">${b.letter}</button>`).join("")}</div>` +
    /* tabindex=-1 so the jump can move focus to the heading, not just the viewport.
       Every row is in the DOM — the honest count depends on it, and so does the A–Z jump —
       but `content-visibility` (in dress.css) lets the browser skip laying out and painting
       the sections nobody is looking at. */
    `<div class="azgrid">${buckets.map(b =>
      `<div class="azsec" style="contain-intrinsic-size:auto ${HEAD_PX + b.rows.length * ROW_PX}px">` +
        `<h2 id="az-${b.letter}" tabindex="-1">${b.letter}<span>${nf(b.rows.length)}</span></h2>` +
        b.rows.map(r =>
          `<a class="azrow" href="${href("/series/" + encodeURIComponent(r.name))}">` +
            `<span class="nm">${esc(r.name)}</span>` +
            `<span class="n" title="${r.mentions} mention${pl(r.mentions)} in ${r.episodes} episode${pl(r.episodes)}">${nf(r.mentions)}</span></a>`).join("") +
      `</div>`).join("")}</div>`;

  const after = (): void => {
    /* The sticky stack is the header plus this bar, and the bar's height triples as its 27
       buttons wrap. Publish it so scroll-margin-top can clear it at any width, the same way
       main.ts publishes --dress-h. A hardcoded 170px hid the target behind the bar below
       ~1000px — the jump landed on the thing that triggered it. */
    const bar = document.querySelector(".azbar");
    if (bar) {
      const publish = (): void => document.documentElement.style.setProperty(
        "--az-h", Math.round(bar.getBoundingClientRect().height) + "px");
      publish();
      new ResizeObserver(publish).observe(bar);
    }
    for (const btn of document.querySelectorAll<HTMLButtonElement>(".azbar [data-jump]")) {
      btn.addEventListener("click", () => {
        const head = document.getElementById(btn.dataset["jump"] ?? "");
        if (!head) return;
        /* Focus so keyboard and screen-reader users actually arrive — moving the viewport
           alone left them where they were. The scroll is explicit rather than focus()'s
           implicit one, which undershot by ~1300px on a 63,000px-tall page at 390px. */
        head.focus({ preventScroll: true });
        /* Instant, against the global scroll-behavior:smooth. This page is 65,000px tall at
           390px, so a smooth jump from A to S animates for seconds through 3,000 rows —
           and lands wherever the animation happens to be when anything else reflows. */
        head.scrollIntoView({ block: "start", behavior: "instant" });
      });
    }
  };

  return { html, after };
}
