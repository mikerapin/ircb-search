import type { EpisodeCore } from "../data/types";
import { esc, fmtRuntime } from "../lib/html";
import { href } from "../router";

/**
 * One <audio> element for the whole site, created once and never destroyed.
 *
 * Four rules come from Blubrry's published stats requirements (final-spec §9) and are not
 * style preferences — breaking any of them corrupts the show's download numbers:
 *   1. no `autoplay` attribute; playback only ever follows a user gesture
 *   2. `preload="none"`, so a page visit is not a download
 *   3. seek with `currentTime` — NEVER append a query param to the enclosure URL, because
 *      Blubrry keys episode identity on the exact URL
 *   4. never proxy or rehost the media; point at the enclosure as published
 */

interface PlayState {
  key: string | null;
  comic: string | null;
  panel: HTMLElement | null;
  /** Where this mention's segment ends — the next logged minute. Null means play to the end. */
  until: number | null;
}

let au: HTMLAudioElement;
let bar: HTMLElement | null;
let lookup: (key: string) => EpisodeCore | undefined = () => undefined;
let play: PlayState = { key: null, comic: null, panel: null, until: null };
let seekPending = false;

/* Where to start once metadata arrives. Module state, not a per-click closure: a second
   click on the same episode before metadata landed added no new listener, so the FIRST
   click's captured `secs` won the seek and the tape started at the wrong comic while the
   UI showed the one just clicked. Only the newest target survives here. */
let pending: { secs: number; panel: HTMLElement; autoplay: boolean } | null = null;

function applyPending(): void {
  const p = pending;
  if (!p) return;
  pending = null;
  const d = au.duration;
  const dl = p.panel.querySelector("[data-role=d]");
  const sl = p.panel.querySelector<HTMLInputElement>("[data-role=seek]");
  if (dl && d && Number.isFinite(d)) dl.textContent = clock(d);
  if (sl && d && Number.isFinite(d)) sl.max = String(Math.floor(d));
  try { au.currentTime = p.secs; } catch { /* not seekable yet */ }
  if (p.autoplay) void au.play().catch(() => {});
}

const clock = (s: number): string => fmtRuntime(Math.max(0, Math.floor(s || 0))) || "0:00";
const firstNames = (people: string[]): string => people.map(p => p.split(" ")[0]).join(" · ");

/** True while the inline player is still on screen; once navigation eats it, the bar takes over. */
function inlineAlive(): boolean {
  return !!(play.panel && document.contains(play.panel));
}

function el(id: string): HTMLElement | null {
  return document.getElementById(id);
}

/** The inline player has its own play/pause button; without this it froze on "II" forever. */
function paintInline(): void {
  if (!inlineAlive() || !play.panel) return;
  const pp = play.panel.querySelector(".player .pp");
  if (pp) {
    pp.textContent = au.paused ? "▶" : "II";
    pp.setAttribute("aria-label", au.paused ? "Play" : "Pause");
  }
  const note = play.panel.querySelector(".player .note");
  if (note) {
    const label = play.comic ?? (play.key ? lookup(play.key)?.title : "") ?? "";
    note.textContent = `${au.paused ? "Paused" : "Playing"} · ${label}`;
  }
}

export function paintBar(): void {
  paintInline();
  if (!bar) return;
  const live = !!play.key && !!au.src;
  const showBar = live && !inlineAlive();
  bar.classList.toggle("on", showBar);
  document.documentElement.style.setProperty("--bar", showBar ? "58px" : "0px");
  if (!live) return;

  const e = play.key ? lookup(play.key) : undefined;
  bar.classList.toggle("paused", au.paused);
  const pp = el("mb-pp"), cm = el("mb-cm"), ep = el("mb-ep"), clk = el("mb-clk");
  if (pp) { pp.textContent = au.paused ? "▶" : "II"; pp.setAttribute("aria-label", au.paused ? "Play" : "Pause"); }
  if (cm) {
    cm.textContent = play.comic ?? e?.title ?? "Now playing";
    cm.setAttribute("href", href("/ep/" + encodeURIComponent(play.key ?? "")));
  }
  if (ep && e) ep.textContent = (play.comic ? e.title + " · " : "") + firstNames(e.people);
  if (clk) {
    const dur = Number.isFinite(au.duration) && au.duration ? au.duration : e?.runtimeSecs ?? 0;
    clk.textContent = clock(au.currentTime) + " / " + (dur ? clock(dur) : "--:--");
  }
}

function playerHTML(secs: number, dur: number | null, label: string, playing = true): string {
  return `<div class="player">
    <div class="row">
      <button class="pp" type="button" data-act="pp" aria-label="${playing ? "Pause" : "Play"}">${playing ? "II" : "▶"}</button>
      <span class="t" data-role="t">${clock(secs)}</span>
      <span class="t" style="margin-left:auto" data-role="d">${dur ? clock(dur) : "--:--"}</span>
    </div>
    <input type="range" min="0" max="${dur || 3600}" value="${secs}" step="15" data-role="seek"
      aria-label="Seek" aria-valuetext="${clock(secs)}">
    <div class="note">${playing ? "Playing" : "Paused"} · ${esc(label)}</div>
  </div>`;
}

function closeCut(panel: HTMLElement): void {
  panel.classList.remove("playing");
  const slot = panel.querySelector(".cutslot");
  if (slot) slot.innerHTML = "";
}

/** Opens the player inside the clicked panel and starts at `secs`. */
export function jumpCut(
  panel: HTMLElement,
  key: string,
  secs: number,
  comic: string | null,
  opts?: { until?: number | null; autoplay?: boolean; seek?: boolean },
): void {
  const e = lookup(key);
  if (!e?.enclosure) return;
  if (play.panel && play.panel !== panel && document.contains(play.panel)) closeCut(play.panel);

  const slot = panel.querySelector(".cutslot");
  if (!slot) return;
  const autoplay = opts?.autoplay !== false;
  const seek = opts?.seek !== false;
  const until = opts?.until ?? readUntil(panel);
  slot.innerHTML = playerHTML(secs, e.runtimeSecs, comic ?? e.title, autoplay);
  panel.classList.add("playing");
  play = { key, comic, panel, until };
  if (!seek && au.dataset["ep"] === key) { paintBar(); return; }   // same tape, already rolling
  seekPending = true;

  if (au.dataset["ep"] !== key) {
    au.dataset["ep"] = key;
    au.src = e.enclosure;                     // exactly as published — no added parameters
    pending = { secs, panel, autoplay };      // the permanent listener in initAudio applies it
    au.load();
  } else if (au.readyState < 1) {
    /* dataset.ep is stamped before the load finishes, so this branch is reachable while
       metadata is still in flight. Hand the newest target over rather than seeking a tape
       that has no duration yet. */
    pending = { secs, panel, autoplay };
  } else {
    pending = null;
    try { au.currentTime = secs; } catch { /* ignore */ }
    if (autoplay) void au.play().catch(() => {}); else au.pause();
  }
  paintBar();
}

function readUntil(panel: HTMLElement): number | null {
  const raw = panel.dataset["until"];
  const n = raw == null || raw === "" ? NaN : Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * A logged minute is the start of a segment, and the next logged minute is its end. When
 * playback reaches that boundary we stop and hand the next segment its own open player,
 * so the read-along walks the episode a comic at a time instead of running past it.
 */
function advanceAtBoundary(): void {
  const panel = play.panel;
  if (!panel || play.until == null || au.currentTime < play.until) return;
  /* A panel removed by a re-render still answers closest(), so the handover would open
     the next player inside a detached tree — playing on, with no visible control. Let
     the mini-bar keep it instead. */
  if (!document.contains(panel)) { play = { ...play, until: null }; paintBar(); return; }

  const root = panel.closest("#readalong, .checklist, .ra-list, .ra-strip, .ra-stack");
  const next = root ? nextPanelAfter(root, panel) : null;
  if (!next) {
    if (!continuous) au.pause();          // last segment: stopping is the whole point
    play = { ...play, until: null };      // ...and don't re-fire on every tick
    paintBar();
    return;
  }

  const key = next.dataset["ep"];
  const secs = Number(next.dataset["secs"]);
  if (!key || !Number.isFinite(secs)) { play = { ...play, until: null }; return; }

  if (continuous) {
    /* Already sitting exactly on the next segment's first second, so re-seeking there would
       only stutter. Move the player, leave the tape running. */
    jumpCut(next, key, secs, next.dataset["comic"] ?? null, { autoplay: true, seek: false });
  } else {
    au.pause();
    // Opened, seeked and waiting — the reader decides whether to keep going.
    jumpCut(next, key, secs, next.dataset["comic"] ?? null, { autoplay: false });
  }
  next.scrollIntoView({ block: "nearest" });
}

const ROLL_KEY = "ircb.letitroll";
let continuous = false;

/** Off by default: a jump lands on one comic and stops there unless the reader says otherwise. */
export function isContinuous(): boolean {
  return continuous;
}

export function setContinuous(on: boolean): void {
  continuous = on;
  try { localStorage.setItem(ROLL_KEY, on ? "1" : "0"); } catch { /* private mode */ }
}

function nextPanelAfter(root: Element, panel: HTMLElement): HTMLElement | null {
  const all = [...root.querySelectorAll<HTMLElement>("[data-secs]")].filter(p => p.querySelector(".cutslot"));
  const i = all.indexOf(panel);
  return i >= 0 ? all[i + 1] ?? null : null;
}

export function stopAll(): void {
  au.pause();
  if (inlineAlive() && play.panel) closeCut(play.panel);
  play = { key: null, comic: null, panel: null, until: null };
  au.removeAttribute("src");
  au.dataset["ep"] = "";
  try { au.load(); } catch { /* ignore */ }
  paintBar();
}

export function initAudio(getEpisode: (key: string) => EpisodeCore | undefined): void {
  lookup = getEpisode;
  const found = el("au");
  if (!(found instanceof HTMLAudioElement)) return;
  au = found;
  bar = el("minibar");
  try { continuous = localStorage.getItem(ROLL_KEY) === "1"; } catch { /* private mode */ }

  au.addEventListener("loadedmetadata", applyPending);
  /* dataset.ep is stamped before the load resolves. Without this, one failed enclosure
     marked that episode as loaded forever and every later click took the "same tape"
     branch, seeking a source that was never there. */
  au.addEventListener("error", () => {
    delete au.dataset["ep"];
    pending = null;
    seekPending = false;
    paintBar();
  });
  au.addEventListener("seeked", () => { seekPending = false; });
  au.addEventListener("play", paintBar);
  au.addEventListener("pause", paintBar);
  au.addEventListener("ended", paintBar);
  au.addEventListener("timeupdate", () => {
    if (seekPending) return;
    advanceAtBoundary();
    paintBar();
    if (!inlineAlive() || !play.panel) return;
    const t = play.panel.querySelector("[data-role=t]");
    const s = play.panel.querySelector<HTMLInputElement>("[data-role=seek]");
    if (t) t.textContent = clock(au.currentTime);
    if (s && document.activeElement !== s) s.value = String(Math.floor(au.currentTime));
    // Without valuetext a screen reader reads the raw second count, not a timestamp.
    if (s) s.setAttribute("aria-valuetext", clock(au.currentTime));
  });

  /* Delegated, because every panel carrying a play control is rendered from a template
     string and replaced on navigation — there is nothing stable to bind to. */
  document.addEventListener("click", ev => {
    const target = ev.target as HTMLElement;
    const hit = target.closest<HTMLElement>("[data-act]");
    if (!hit) return;
    const act = hit.dataset["act"];

    if (act === "cut" || act === "cut-ep") {
      const panel = hit.closest<HTMLElement>(".panel, .rawrap, .clrow, .meta, .shb");
      const key = hit.dataset["ep"] ?? panel?.dataset["ep"];
      if (!panel || !key) return;
      ev.preventDefault();
      const secs = act === "cut-ep" ? 0 : Number(hit.dataset["secs"] ?? panel.dataset["secs"] ?? 0);
      jumpCut(panel, key, Number.isFinite(secs) ? secs : 0, hit.dataset["comic"] ?? panel.dataset["comic"] ?? null);
    } else if (act === "pp") {
      ev.preventDefault();
      if (au.paused) void au.play().catch(() => {}); else au.pause();
    }
  });

  document.addEventListener("input", ev => {
    const t = ev.target as HTMLElement;
    if (t.dataset?.["role"] === "seek") {
      try { au.currentTime = Number((t as HTMLInputElement).value); } catch { /* ignore */ }
    }
  });

  el("mb-pp")?.addEventListener("click", () => {
    if (au.paused) void au.play().catch(() => {}); else au.pause();
  });
  el("mb-x")?.addEventListener("click", stopAll);

  // Navigation destroys the inline player; the bar inherits the session mid-sentence.
  /* Watch the DOM, not the URL. paintBar was driven by media events plus a hashchange
     timeout, so any swap that removed the playing panel WITHOUT a route change — the
     read-along layout toggle re-rendering its block, for instance — left the inline
     player gone and the mini-bar hidden, with no control anywhere for audio that is
     still loaded. A paused tape fires no media event to recover from, either. */
  const view = document.getElementById("view");
  if (view) {
    /* React only when the panel's existence flips. paintBar -> paintInline writes
       textContent inside that same panel, which is itself a childList mutation, so an
       unguarded observer re-enters itself forever. */
    let wasAlive: boolean | null = null;
    new MutationObserver(() => {
      if (!play.key) return;
      const alive = inlineAlive();
      if (alive === wasAlive) return;
      wasAlive = alive;
      paintBar();
    }).observe(view, { childList: true, subtree: true });
  }
  window.addEventListener("hashchange", () => setTimeout(paintBar, 0));
  paintBar();
}
