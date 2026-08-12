/**
 * Globals the audio specs install in the page to observe playback.
 *
 * `<audio>` reports `currentTime` from a live clock, so reading it after the fact races the
 * tape. These arrays are pushed to from inside the event handlers, freezing what was true
 * when the event fired, and the assertion reads the record rather than the element.
 */
declare global {
  interface Window {
    __seeks?: number[];
    /* The Media Session action handlers the page registered, keyed by action —
       the specs call them to simulate a lock-screen button. */
    __transport?: Record<string, (details?: { seekTime?: number }) => void>;
  }
}

export {};
