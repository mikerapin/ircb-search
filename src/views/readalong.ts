import type { EpisodeCore, Mention } from "../data/types";
import { esc, fmtDate, fmtRuntime, nf, pl, simplecastAt } from "../lib/html";
import { href } from "../router";
import { jumpable } from "../search/engine";
import { mentionPanel, playAffordance } from "./components";

// Re-exported so the episode page and Plan 3 have one obvious import site.
export { playAffordance };

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

function raListRow(m: Mention, ep: EpisodeCore | undefined): string {
  const can = jumpable(m, ep);
  const meta = [m.segment, ep?.date ? fmtDate(ep.date) : null].filter(Boolean).join(" · ");
  const body =
    `<span class="t${can ? "" : " none"}">${can ? esc(fmtRuntime(m.secs)) : "—:——"}</span>` +
    `<span><span class="cm">${esc(m.comic)}</span>${meta ? `<span class="mt">${esc(meta)}</span>` : ""}</span>` +
    `<span class="cue">${can ? "▶ Play" : "Open →"}</span>`;
  const at = can ? simplecastAt(ep?.simplecastUrl ?? null, m.secs) : null;
  const dest = at ?? href("/ep/" + encodeURIComponent(m.epKey));
  const ext = at ? ` target="_blank" rel="noopener noreferrer"` : "";
  return `<div class="rawrap"><a class="ra-row" href="${esc(dest)}"${ext}>${body}</a></div>`;
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
