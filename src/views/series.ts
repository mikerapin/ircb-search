import { core, mentions as loadMentions } from "../data/load";
import { ROSTER_MAP, isRoster } from "../data/roster";
import { seriesRows } from "../data/series-index";
import { TAGGED } from "../data/shape";
import type { EpisodeCore, Mention } from "../data/types";
import { esc, fmtDate, fmtRuntime, nf, pl } from "../lib/html";
import { href } from "../router";
import { jumpable } from "../search/engine";
import { subscribeCoupon } from "./blocks";
import { emptyState, sfx } from "./components";
import { cover, fitPlates } from "./cover";

function avatar(name: string): string {
  const p = ROSTER_MAP.get(name);
  return p ? `<img src="${esc(p.photo)}" alt="" loading="lazy">` : `<span class="ph"></span>`;
}

const firstName = (n: string): string => n.split(" ")[0] ?? n;

export async function viewSeries(name: string): Promise<{ html: string; after: () => void }> {
  const data = await core();
  const men = await loadMentions();
  const byKey = new Map(data.episodes.map(e => [e.key, e]));

  /* Exact heading only. "All-Star Batman" is its own work under the published rules, so
     letting it into Batman's checklist would put a 143-row list under a 45-mention headline.
     The near-misses get a See Also rail instead of a silently inflated count. */
  const lc = name.toLowerCase();
  const mine = men.filter(m => m.series.toLowerCase() === lc);

  if (!mine.length) {
    return {
      html: `<div class="crumb"><a href="${href("/")}">← The Cover</a> · <a href="${href("/index")}">The Index</a></div>` +
        emptyState(name || "Unknown series", "Nothing in the index under that heading.", href("/index"), "Browse every series →"),
      after: () => {},
    };
  }

  const rows = mine.slice().sort((a, b) =>
    (byKey.get(a.epKey)?.date ?? "").localeCompare(byKey.get(b.epKey)?.date ?? ""));
  const dates = rows.map(m => byKey.get(m.epKey)?.date).filter((d): d is string => !!d);
  const eps = new Set(mine.map(m => m.epKey));

  // Separate works that share the name — "Batman" surfaces "All-Star Batman", not folds it.
  const also = seriesRows(men)
    .filter(r => r.name.toLowerCase() !== lc && r.name.toLowerCase().includes(lc))
    .slice(0, 14);

  // Who keeps bringing it up: roster voices only, counted per episode.
  const tally = new Map<string, number>();
  for (const k of eps) {
    for (const p of byKey.get(k)?.people ?? []) if (isRoster(p)) tally.set(p, (tally.get(p) ?? 0) + 1);
  }
  const voices = [...tally].sort((a, b) => b[1] - a[1]).slice(0, 6);

  const pat = data.patreonSeries.find(p => lc.includes(p.pattern.toLowerCase()));
  const total = mine.length, epCount = eps.size;
  const nTagged = mine.filter(m => m.segment === TAGGED).length;

  const html =
    `<div class="crumb"><a href="${href("/")}">← The Cover</a> · <a href="${href("/index")}">The Index</a></div>` +
    `<section class="sec"><div class="issue-head">
      <div class="art" style="container-type:inline-size;background:var(--paper)">${cover(name, "tall", dates[0]?.slice(0, 4) ?? name, null)}</div>
      <div class="meta">
        <div class="micro">The Run</div>
        <h1 class="disp">${esc(name)}</h1>
        <div class="statline"><b>${nf(total)}</b> mention${pl(total)} indexed · <b>${nf(epCount)}</b> episode${pl(epCount)}${
          dates.length ? ` · on air ${dates[0]?.slice(0, 4)} → ${dates[dates.length - 1]?.slice(0, 4)}` : ""}</div>
        ${voices.length ? `<div><div class="micro" style="margin-bottom:7px">Who keeps bringing it up</div>
          <div class="crew">${voices.map(([who, n]) =>
            `<a href="${href("/who/" + encodeURIComponent(who))}">${avatar(who)}${esc(firstName(who))} <span class="n">${n}</span></a>`).join("")}</div></div>` : ""}
        <div class="spacer"></div>
        ${pat ? `<div class="linkrow"><a href="${esc(pat.url)}">Bonus series: ${esc(pat.name)} on Patreon →</a></div>` : ""}
        <div class="linkrow">
          <a href="${href("/search", { q: name })}">See these as a page of panels →</a>
        </div>
      </div>
    </div></section>` +
    (also.length
      ? `<section class="sec"><div class="sec-head"><h2 class="disp">See Also</h2>
          <span class="note">Separate works that share the name<br><a href="${href("/about")}">Why they&rsquo;re shelved apart →</a></span></div>
          <div class="chips">${also.map(r =>
            `<a class="chip" href="${href("/series/" + encodeURIComponent(r.name))}">${esc(r.name)}<span class="n">${nf(r.mentions)}</span></a>`).join("")}</div></section>`
      : "") +
    sfx(`${nf(total)} mention${pl(total)}`) +
    `<section class="sec">
      <div class="sec-head"><h2 class="disp">The Checklist</h2>
        <span class="note">Oldest first · ${nTagged
          /* The claim only holds for rows read out of the notes. A tagged row carries the
             shelf's own name because that is all a keyword gives you, so a checklist holding
             any has to say so rather than present them as our spelling on the day. */
          ? `${nf(total - nTagged)} as we wrote ${total - nTagged === 1 ? "it" : "them"}, ` +
            `${nf(nTagged)} from an episode&rsquo;s tags`
          : "every time we wrote it exactly this way"}</span></div>
      <div class="checklist">
        <div class="hd"><span>Item &amp; where it came up</span><span class="r">${nf(rows.length)} row${pl(rows.length)}</span></div>
        ${rows.map(m => checklistRow(m, byKey.get(m.epKey))).join("")}
      </div>
    </section>` +
    subscribeCoupon();

  return { html, after: () => { requestAnimationFrame(() => fitPlates(document)); } };
}

/* Most rows on a long run carry no minute. A row of dead grey buttons reads as breakage,
   so the absence stays a quiet label and only a real jump gets a control. */
function checklistRow(m: Mention, ep: EpisodeCore | undefined): string {
  const can = jumpable(m, ep);
  const epLink = href("/ep/" + encodeURIComponent(m.epKey));
  return `<div class="clrow panel" data-ep="${esc(m.epKey)}" data-secs="${m.secs ?? ""}" data-comic="${esc(m.comic)}">` +
    `<div class="t"><div class="cm">${esc(m.comic)}</div>` +
      `<div class="ep"><a href="${epLink}">${esc(ep?.title || "Untitled")}</a> · ${esc(fmtDate(ep?.date ?? null) || "date unknown")}` +
        `${m.segment ? " · " + esc(m.segment) : ""}</div><div class="cutslot"></div></div>` +
    (can
      ? (ep?.enclosure
          ? `<button class="ts" type="button" data-act="cut"><span class="tri">▶</span>${esc(fmtRuntime(m.secs))}</button>`
          : `<a class="ts" href="${epLink}"><span class="tri">▶</span>${esc(fmtRuntime(m.secs))}</a>`)
      // Same three-way branch as playAffordance: a stamp past the runtime has a minute.
      : `<a class="nomin" href="${epLink}">${!ep?.enclosure ? "no audio"
          : m.secs == null ? "no minute logged" : "timestamp out of range"} →</a>`) +
  `</div>`;
}
