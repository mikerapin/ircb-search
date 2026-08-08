import type { EpisodeCore, Mention } from "../data/types";
import { esc, fmtDate, fmtRuntime, nf, pl } from "../lib/html";
import { href } from "../router";
import { jumpable } from "../search/engine";
import { mentionPanel } from "./components";

export type RaMode = "strip" | "stack" | "list";

const RA_KEY = "ircb.readalong";

export function raMode(): RaMode {
  try {
    const v = localStorage.getItem(RA_KEY);
    if (v === "strip" || v === "stack" || v === "list") return v;
  } catch { /* private mode */ }
  return "strip";
}

export function setRaMode(v: RaMode): void {
  try { localStorage.setItem(RA_KEY, v); } catch { /* private mode */ }
}

export function raToggle(): string {
  const m = raMode();
  // A real button group, so aria-pressed is the correct attribute here.
  return `<div class="togg" role="group" aria-label="Read-along layout">` +
    (["strip", "stack", "list"] as const).map(k =>
      `<button type="button" data-act="ra" data-ra="${k}" aria-pressed="${m === k}">` +
        { strip: "Strip", stack: "Stacked", list: "Timestamps" }[k] + `</button>`).join("") +
  `</div>`;
}

/**
 * The one place a play affordance is built. Plan 3 replaces the body of this function with
 * the Jump Cut player; every read-along layout and the search plates go through it, so the
 * swap is one function rather than a sweep.
 */
export function playAffordance(m: Mention, ep: EpisodeCore | undefined): string {
  const epLink = href("/ep/" + encodeURIComponent(m.epKey));
  if (!jumpable(m, ep)) {
    return `<a class="ts dead" href="${epLink}">${ep?.enclosure ? "No minute logged" : "No audio on file"}<span class="lab">Open</span></a>`;
  }
  return `<a class="ts" href="${epLink}"><span class="tri">▶</span>${esc(fmtRuntime(m.secs))}<span class="lab">Jump</span></a>`;
}

function raListRow(m: Mention, ep: EpisodeCore | undefined): string {
  const can = jumpable(m, ep);
  const meta = [m.segment, ep?.date ? fmtDate(ep.date) : null].filter(Boolean).join(" · ");
  const body =
    `<span class="t${can ? "" : " none"}">${can ? esc(fmtRuntime(m.secs)) : "—:——"}</span>` +
    `<span><span class="cm">${esc(m.comic)}</span>${meta ? `<span class="mt">${esc(meta)}</span>` : ""}</span>` +
    `<span class="cue">${can ? "▶ Play" : "Open →"}</span>`;
  return `<div class="rawrap"><a class="ra-row" href="${href("/ep/" + encodeURIComponent(m.epKey))}">${body}</a></div>`;
}

export function readAlong(
  mentions: Mention[],
  byKey: Map<string, EpisodeCore>,
  gap: { episodes: number; indexed: number },
): string {
  if (!mentions.length) {
    const missing = gap.episodes - gap.indexed;
    return `<p class="lead">Nobody logged the comics for this one — it&rsquo;s one of the ${nf(missing)} episode${pl(missing)} the mention index never reached.</p>`;
  }
  const mode = raMode();
  if (mode === "list") {
    return `<div class="ra-list">${mentions.map(m => raListRow(m, byKey.get(m.epKey))).join("")}</div>`;
  }
  const cls = mode === "stack" ? "ra-stack" : "ra-strip";
  return `<div class="${cls}">${mentions.map(m => mentionPanel(m, byKey.get(m.epKey))).join("")}</div>`;
}

/** Wires the layout toggle. `onChange` re-renders the block in the new mode. */
export function wireReadAlong(root: ParentNode, onChange: () => void): void {
  for (const btn of root.querySelectorAll<HTMLButtonElement>('[data-act="ra"]')) {
    btn.addEventListener("click", () => {
      const mode = btn.dataset["ra"];
      if (mode !== "strip" && mode !== "stack" && mode !== "list") return;
      setRaMode(mode);
      onChange();
    });
  }
}
