import type { EpisodeCore, Mention } from "../data/types";
import { esc, fmtDate, fmtRuntime, nf, pl } from "../lib/html";
import { href } from "../router";
import { jumpable } from "../search/engine";
import { isContinuous, setContinuous } from "../audio/engine";
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

function raListRow(m: Mention, ep: EpisodeCore | undefined, until: number | null): string {
  const can = jumpable(m, ep);
  const meta = [m.segment, ep?.date ? fmtDate(ep.date) : null].filter(Boolean).join(" · ");
  const body =
    `<span class="t${can ? "" : " none"}">${can ? esc(fmtRuntime(m.secs)) : "—:——"}</span>` +
    `<span><span class="cm">${esc(m.comic)}</span>${meta ? `<span class="mt">${esc(meta)}</span>` : ""}</span>` +
    `<span class="cue">${can ? "▶ Play" : "Open →"}</span>`;
  if (can && ep?.enclosure) {
    return `<div class="rawrap panel" data-ep="${esc(m.epKey)}" data-secs="${m.secs}" data-comic="${esc(m.comic)}"${until != null ? ` data-until="${until}"` : ""}>` +
      `<button class="ra-row" type="button" data-act="cut">${body}</button><div class="cutslot"></div></div>`;
  }
  /* Reached only when the row is not playable, since `can` implies an enclosure. The
     Simplecast fallback that used to sit here was unreachable for the same reason. */
  const dest = href("/ep/" + encodeURIComponent(m.epKey));
  return `<div class="rawrap"><a class="ra-row" href="${esc(dest)}">${body}</a></div>`;
}

/* A logged minute starts a segment; the next one ends it. Only the read-along knows this,
   because only there are the mentions one episode in broadcast order. */
function boundary(list: Mention[], i: number): number | null {
  for (let j = i + 1; j < list.length; j++) {
    const s = list[j]?.secs;
    if (s != null && s > (list[i]?.secs ?? 0)) return s;
  }
  return null;
}

export function readAlong(
  mentions: Mention[],
  byKey: Map<string, EpisodeCore>,
  gap: { episodes: number; indexed: number },
): string {
  if (!mentions.length) {
    const missing = gap.episodes - gap.indexed;
    return `<p class="lead">Nobody logged the comics for this one. It&rsquo;s one of ${nf(missing)} episode${pl(missing)} we never got around to indexing.</p>`;
  }
  const mode = raMode();
  if (mode === "list") {
    return `<div class="ra-list">${mentions.map((m, i) => raListRow(m, byKey.get(m.epKey), boundary(mentions, i))).join("")}</div>`;
  }
  const cls = mode === "stack" ? "ra-stack" : "ra-strip";
  return `<div class="${cls}">${mentions.map((m, i) => mentionPanel(m, byKey.get(m.epKey), { until: boundary(mentions, i) })).join("")}</div>`;
}

/**
 * Off by default: a jump lands on one comic and stops there. Ticking this keeps the tape
 * running past each boundary while the player still walks to the next comic.
 */
export function rollToggle(): string {
  const on = isContinuous();
  return `<label class="roll"><input type="checkbox" data-act="roll"${on ? " checked" : ""}>` +
    `<span>Let it roll</span></label>`;
}

/** Wires the layout toggle. `onChange` re-renders the block in the new mode. */
export function wireReadAlong(root: ParentNode, onChange: () => void): void {
  const roll = root.querySelector<HTMLInputElement>('[data-act="roll"]');
  roll?.addEventListener("change", () => setContinuous(roll.checked));

  for (const btn of root.querySelectorAll<HTMLButtonElement>('[data-act="ra"]')) {
    btn.addEventListener("click", () => {
      const mode = btn.dataset["ra"];
      if (mode !== "strip" && mode !== "stack" && mode !== "list") return;
      const hadFocus = document.activeElement === btn;
      setRaMode(mode);
      onChange();
      /* onChange re-renders the whole block, destroying the button that was just pressed —
         focus fell to <body> and the aria-pressed flip was announced to nobody. The
         replacement carries aria-pressed="true", so focusing it announces the new state. */
      if (hadFocus) {
        document.querySelector<HTMLButtonElement>(`[data-act="ra"][data-ra="${mode}"]`)?.focus();
      }
    });
  }
}
