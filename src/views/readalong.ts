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

/**
 * One timestamp row. Shared by the episode read-along, the Wall's rail and the episode-led
 * search card, so how a logged minute is offered is one function everywhere.
 *
 * `withDate` is off wherever the container already states the date — a search card names it
 * once at the top, and repeating it under every comic is noise, not information.
 */
export function raListRow(
  m: Mention,
  ep: EpisodeCore | undefined,
  until: number | null,
  opts?: { withDate?: boolean; also?: Mention[]; here?: boolean },
): string {
  const can = jumpable(m, ep);
  const date = opts?.withDate === false ? null : (ep?.date ? fmtDate(ep.date) : null);
  const meta = [m.segment, date].filter(Boolean).join(" · ");
  /* Everything logged at this same minute. The show notes stamp a segment once and then list
     what was discussed in it, so one minute can carry 19 books — and rendering a row each gave
     19 identical timestamps and 19 buttons that all seek to the same second. */
  const titles = [m, ...(opts?.also ?? [])]
    .map(x => `<span class="cm">${esc(x.comic)}</span>`).join("");
  /* On the episode's own read-along there is nowhere for "Open" to go — it links to the page
     the reader is already on. The cue is for a row that can actually take you somewhere. */
  const cue = can ? "▶ Play" : opts?.here ? "" : "Open →";
  const body =
    `<span class="t${can ? "" : " none"}">${can ? esc(fmtRuntime(m.secs)) : "—:——"}</span>` +
    `<span>${titles}${meta ? `<span class="mt">${esc(meta)}</span>` : ""}</span>` +
    (cue ? `<span class="cue">${cue}</span>` : "");
  /* Identity rides on every row, playable or not. The segment handover only ever walks rows
     that also carry a `.cutslot`, so a dead row still cannot be handed the tape — but now
     anything reading the page can tell which mention a refusal belongs to, which is what a
     test needs to decide each row against the data rather than trusting the markup. */
  const id = `data-ep="${esc(m.epKey)}" data-secs="${m.secs ?? ""}" data-comic="${esc(m.comic)}"`;
  if (can && ep?.enclosure) {
    return `<div class="rawrap panel" ${id}${until != null ? ` data-until="${until}"` : ""}>` +
      `<button class="ra-row" type="button" data-act="cut">${body}</button><div class="cutslot"></div></div>`;
  }
  /* Reached only when the row is not playable, since `can` implies an enclosure. The
     Simplecast fallback that used to sit here was unreachable for the same reason. */
  if (opts?.here) return `<div class="rawrap" ${id}><div class="ra-row static">${body}</div></div>`;
  const dest = href("/ep/" + encodeURIComponent(m.epKey));
  return `<div class="rawrap" ${id}><a class="ra-row" href="${esc(dest)}">${body}</a></div>`;
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

/**
 * Broadcast order, and a minute that was never logged sorts last rather than to the top.
 *
 * `a.secs ?? 0` would collapse every unstamped mention to zero and lead the list with them,
 * which is the bug the episode page already fixed for itself. The Wall's rail called this
 * with whatever order the mention list happened to be in, so it showed a screen of "—:——"
 * before the first real minute. Sorting here rather than in each caller is what keeps the two
 * from disagreeing. Copies, because the caller's array is used for other things.
 */
function inBroadcastOrder(mentions: Mention[]): Mention[] {
  return mentions.slice().sort((a, b) => {
    if (a.secs == null && b.secs == null) return 0;
    if (a.secs == null) return 1;
    if (b.secs == null) return -1;
    return a.secs - b.secs;
  });
}

/**
 * Mentions that share a logged minute are one moment.
 *
 * The show notes stamp a segment once and list what was discussed under it, so a single minute
 * routinely carries a pile of books — 19 on the Superman episode, 47 on the worst. Measured
 * across the archive, 50 episodes have three or more comics on one stamp and about a quarter
 * of every stamped row sits in such a pile. Rendered one row each, that is a screen of
 * identical timestamps offering identical jumps.
 *
 * Only stamped mentions group. The unstamped ones are separate books that nobody timed, and
 * folding them together would claim they share a moment when what they share is an absence.
 */
function byStamp(mentions: Mention[]): Mention[][] {
  const out: Mention[][] = [];
  for (const m of mentions) {
    const last = out[out.length - 1];
    if (last && m.secs != null && last[0]?.secs === m.secs) last.push(m);
    else out.push([m]);
  }
  return out;
}

/**
 * `mode` overrides the reader's saved layout, for a container that cannot honour it. The
 * Wall's rail is 392px wide, and `strip` — the default — is a horizontal scroller sized for
 * a full-width page; in the rail it became a one-card-wide sideways slider inside a slide-out
 * panel. A layout preference set on the episode page should not follow the reader into a
 * column that has no room for it.
 */
export function readAlong(
  mentions: Mention[],
  byKey: Map<string, EpisodeCore>,
  gap: { episodes: number; indexed: number },
  opts?: { mode?: RaMode; withDate?: boolean },
): string {
  if (!mentions.length) {
    const missing = gap.episodes - gap.indexed;
    return `<p class="lead">Nobody logged the comics for this one. It&rsquo;s one of ${nf(missing)} episode${pl(missing)} we never got around to indexing.</p>`;
  }
  const mode = opts?.mode ?? raMode();
  /* Both callers pass one episode's own mentions — the episode page and the Wall's rail — so
     everything below is "here", and a row has nowhere to send the reader that they are not
     already looking at. */
  const ordered = inBroadcastOrder(mentions);
  if (mode === "list") {
    const groups = byStamp(ordered);
    return `<div class="ra-list">${groups.map((g, i) => {
      const [head, ...also] = g;
      if (!head) return "";
      return raListRow(head, byKey.get(head.epKey), boundary(groups.map(x => x[0]!), i),
        { withDate: opts?.withDate, also, here: true });
    }).join("")}</div>`;
  }
  const cls = mode === "stack" ? "ra-stack" : "ra-strip";
  return `<div class="${cls}">${ordered.map((m, i) =>
    mentionPanel(m, byKey.get(m.epKey), { until: boundary(ordered, i), here: true })).join("")}</div>`;
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
