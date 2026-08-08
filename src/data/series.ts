/* A handful of item strings were scraped straight out of show-note HTML and still carry
   tag fragments ("…Special #1.</P><P><STRONG"). Strip them for display; the About page
   owns the confession that they exist. */
export function clean(str: unknown): string {
  return String(str == null ? "" : str).replace(/<\/?[a-z][^>]*>?/gi, "").replace(/\s+/g, " ").trim();
}

/** Group a mention under its series: strip issue numbers, volumes, trailing years, ft. credits. */
export function normalizeSeries(comic: string): string {
  const c = clean(comic);
  const out = c
    .replace(/#\s*[0-9]+.*$/, "")                        // "#50", "#1-6", "#20–24 and friends"
    .replace(/\b(vol\.?|volume|volumes|book)\s*[0-9]+.*$/i, "")
    .replace(/\s*\(\d{4}\)\s*$/, "")                     // trailing "(1991)"
    .replace(/\s+ft\..+$/i, "")                          // "ft. Ed Brubaker"
    .replace(/[\s,:\-–]+$/, "")
    .trim();
  return out || c;
}
