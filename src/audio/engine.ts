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

/**
 * What is playing, in two lines. The mini-bar and the OS lock screen must never disagree
 * about this, so they read the same function rather than each building the strings.
 */
function nowPlaying(): { primary: string; secondary: string; ep: EpisodeCore | undefined } {
  const ep = play.key ? lookup(play.key) : undefined;
  return {
    ep,
    primary: play.comic ?? ep?.title ?? "Now playing",
    secondary: (play.comic && ep ? ep.title + " · " : "") + firstNames(ep?.people ?? []),
  };
}

/**
 * Media Session — the lock screen, the notification shade and the hardware keys.
 *
 * Metadata only; the transport handlers are wired once in `initAudio`. Rule 3 still binds:
 * the OS seek arrives as a time, and it goes through `scrub()` like every other hand seek,
 * never as a parameter on the enclosure URL.
 */
function paintMediaSession(): void {
  const ms = navigator.mediaSession as MediaSession | undefined;
  if (!ms || typeof MediaMetadata !== "function") return;

  const { ep, primary, secondary } = nowPlaying();
  if (!play.key || !ep) {
    ms.metadata = null;
    ms.playbackState = "none";
    return;
  }
  ms.metadata = new MediaMetadata({
    title: primary,
    artist: secondary,
    album: "I Read Comic Books",
    /* The podcast host's own artwork, the same URL the page already renders. 3000×3000 is
       what Simplecast serves; the OS picks the size it wants. */
    artwork: ep.artwork ? [{ src: ep.artwork, sizes: "3000x3000", type: "image/jpeg" }] : [],
  });
  ms.playbackState = au.paused ? "paused" : "playing";

  /* Without this the lock screen's scrubber is drawn but inert. It throws on a duration
     that is not a finite number, which is every moment before metadata lands. */
  const d = au.duration;
  if (typeof ms.setPositionState === "function" && Number.isFinite(d) && d > 0) {
    try {
      ms.setPositionState({ duration: d, position: Math.min(au.currentTime, d), playbackRate: au.playbackRate });
    } catch { /* a position past duration mid-seek */ }
  }
}

/**
 * Playhead sync — the read-along tracks the tape.
 *
 * The segment machinery only marks the panel a jump opened. Anything else that moves the
 * playhead — "Play from the top", a drag on the slider, the lock-screen scrubber, "Let it
 * roll" running on — left every row looking identical while the tape was somewhere else
 * entirely. This marks the last logged minute the playhead has passed, whatever moved it.
 */
let nowRow: HTMLElement | null = null;

function paintPlayhead(): void {
  let want: HTMLElement | null = null;
  if (play.key) {
    const t = au.currentTime;
    let best = -1;
    for (const row of document.querySelectorAll<HTMLElement>(`[data-secs][data-ep="${CSS.escape(play.key)}"]`)) {
      /* Identity is stamped on the row AND on the control inside it, and "Play from the top"
         is a control carrying `data-secs="0"`. Without this filter the marker landed on the
         inner button — where neither `.rawrap.now` nor `.panel.now` paints anything — and at
         t=0 it marked the play-from-the-top button as though zero were a logged minute.
         A cutslot is what makes something a row: it is the same test the segment handover
         uses to decide what can be handed the tape. */
      if (!row.querySelector(".cutslot")) continue;
      const raw = row.dataset["secs"];
      /* A row with no logged minute carries `data-secs=""`, and Number("") is 0 — which
         would mark every unjumpable comic in the episode the moment the tape started. */
      const s = raw ? Number(raw) : NaN;
      if (!Number.isFinite(s) || s > t || s < best) continue;
      best = s;
      want = row;
    }
  }
  if (want === nowRow) return;
  /* A re-render leaves the old row detached; removing a class from it is harmless, and the
     new element is a different node, so this correctly re-marks after a repaint. */
  nowRow?.classList.remove("now");
  nowRow?.removeAttribute("aria-current");
  want?.classList.add("now");
  want?.setAttribute("aria-current", "true");
  nowRow = want;
}

export function paintBar(): void {
  paintInline();
  paintMediaSession();
  paintPlayhead();
  if (!bar) return;
  const live = !!play.key && !!au.src;
  const showBar = live && !inlineAlive();
  /* .on toggles the bar back to display:none, which blurs whatever inside it had focus —
     "Stop and close" strands the listener on <body> the moment it succeeds. Same bug
     closeMenu() guards against in shell.ts; the guard was never applied here. */
  if (!showBar && bar.contains(document.activeElement)) el("view")?.focus({ preventScroll: true });
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

/** Seek granularity, in seconds — also what one arrow press moves. */
const SEEK_STEP = 15;

/**
 * Every hand seek goes through here: the slider, and the OS transport controls.
 *
 * Rule 3 lives in one place because of it — `currentTime` only, never a parameter appended
 * to the enclosure URL, which is how Blubrry identifies the episode.
 */
function scrub(secs: number): void {
  try { au.currentTime = Math.max(0, secs); } catch { /* not seekable yet */ }
  /* A hand seek opts out of the segment stop. Without this the next timeupdate saw
     currentTime >= until, read the drag as a completed segment, paused, handed over to the
     next panel and seeked backwards to its start. The slider's max is the whole episode, so
     the control has to deliver the whole episode — and so does the lock screen. */
  if (play.until != null && au.currentTime >= play.until) play = { ...play, until: null };
  paintBar();
}

/** The value a range input will actually hold, given it snaps to SEEK_STEP and clamps to max. */
function snap(secs: number, max: number): number {
  return Math.min(Math.max(0, Math.round(secs / SEEK_STEP) * SEEK_STEP), max);
}

function playerHTML(secs: number, dur: number | null, label: string, playing = true): string {
  const max = dur || 3600;
  /* One number drives both. The browser snaps `value` to the step while aria-valuetext was
     written from the unsnapped time, so the thumb and the position a screen reader reads
     described instants up to 14 seconds apart. Exact playback time lives in `.t`. */
  const pos = snap(secs, max);
  return `<div class="player">
    <div class="row">
      <button class="pp" type="button" data-act="pp" aria-label="${playing ? "Pause" : "Play"}">${playing ? "II" : "▶"}</button>
      <span class="t" data-role="t">${clock(secs)}</span>
      <span class="t" style="margin-left:auto" data-role="d">${dur ? clock(dur) : "--:--"}</span>
    </div>
    <input type="range" min="0" max="${max}" value="${pos}" step="${SEEK_STEP}" data-role="seek"
      aria-label="Seek" aria-valuetext="${clock(pos)}">
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
  /* Captured before closeCut wipes the old cutslot: at a segment boundary the engine
     destroys the player the listener may have been holding focus in, dropping them to
     <body> mid-playback. Restored on the new player below — this only ever moves focus
     that we ourselves just destroyed. */
  const keptFocus = !!play.panel && play.panel.contains(document.activeElement);
  if (play.panel && play.panel !== panel && document.contains(play.panel)) closeCut(play.panel);

  const slot = panel.querySelector(".cutslot");
  if (!slot) return;
  const autoplay = opts?.autoplay !== false;
  const seek = opts?.seek !== false;
  const until = opts?.until ?? readUntil(panel);
  slot.innerHTML = playerHTML(secs, e.runtimeSecs, comic ?? e.title, autoplay);
  panel.classList.add("playing");
  if (keptFocus) panel.querySelector<HTMLButtonElement>(".player .pp")?.focus();
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
  if (i < 0) return null;
  /* Skip any panel still sitting inside the segment that just ended. boundary() in
     readalong.ts requires a strictly later minute, so with two comics logged at the same
     stamp the segment end was the *third* comic's minute while plain DOM order handed over
     to the second — whose data-secs is the minute already playing, seeking the tape
     backwards. The handover has to agree with the boundary it stopped at. */
  return all.slice(i + 1).find(p => Number(p.dataset["secs"]) >= (play.until ?? 0)) ?? null;
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
  /* ...and it must not leave a player that lies. paintInline reads au.paused, which is true
     for a tape that never loaded, so the dead player repainted as "Paused · <comic>" behind
     a Play button that could never work and no message anywhere. Say so instead, and end the
     session so the mini-bar doesn't claim one either. Clearing dataset.ep above means the
     same play control retries for real on the next click. */
  au.addEventListener("error", () => {
    delete au.dataset["ep"];
    pending = null;
    seekPending = false;
    const panel = play.panel;
    play = { key: null, comic: null, panel: null, until: null };
    if (panel && document.contains(panel)) {
      panel.classList.remove("playing");
      const slot = panel.querySelector(".cutslot");
      if (slot) slot.innerHTML = `<div class="player"><div class="note" role="status">That audio didn’t load.</div></div>`;
    }
    paintBar();
  });
  /* Repaint on the seek itself, not only on the next timeupdate. A paused tape fires no
     timeupdate, so a scrub from the lock screen or the slider while paused left the
     playhead marker and the clock describing where the tape used to be. */
  au.addEventListener("seeked", () => { seekPending = false; paintBar(); });
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
    if (s) {
      if (document.activeElement !== s) s.value = String(snap(au.currentTime, Number(s.max)));
      /* Read the value back rather than re-deriving from currentTime: without valuetext a
         screen reader reads the raw second count, and derived from the unsnapped time it
         disagreed with the thumb by up to 14 seconds. */
      s.setAttribute("aria-valuetext", clock(Number(s.value)));
    }
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
    if (t.dataset?.["role"] === "seek") scrub(Number((t as HTMLInputElement).value));
  });

  /* The lock screen, the notification shade, the headphone buttons. Every one of these
     routes into the same engine — a parallel play path would be a second place for the
     four stats rules to be broken. */
  const ms = navigator.mediaSession as MediaSession | undefined;
  if (ms) {
    const on = (action: MediaSessionAction, handler: MediaSessionActionHandler): void => {
      // A browser that does not know an action throws rather than ignoring it.
      try { ms.setActionHandler(action, handler); } catch { /* unsupported action */ }
    };
    on("play", () => { void au.play().catch(() => {}); });
    on("pause", () => au.pause());
    on("stop", () => stopAll());
    on("seekto", d => { if (typeof d.seekTime === "number") scrub(d.seekTime); });
    on("seekbackward", d => scrub(au.currentTime - (d.seekOffset ?? SEEK_STEP)));
    on("seekforward", d => scrub(au.currentTime + (d.seekOffset ?? SEEK_STEP)));
  }

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
