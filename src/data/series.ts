/* A handful of item strings were scraped straight out of show-note HTML and still carry
   tag fragments ("…Special #1.</P><P><STRONG"). Strip them for display; the About page
   owns the confession that they exist. */
export function clean(str: unknown): string {
  return String(str == null ? "" : str).replace(/<\/?[a-z][^>]*>?/gi, "").replace(/\s+/g, " ").trim();
}

/**
 * Display name for a mention's series: strip issue numbers, volumes, manga chapters,
 * trailing years and ft. credits. This is what a reader sees.
 */
export function normalizeSeries(comic: string, yearSensitive?: ReadonlySet<string>): string {
  const c = clean(comic);
  const out = c
    .replace(/#\s*[0-9]+.*$/, "")                                     // "#50", "#1-6", "#20–24 and friends"
    .replace(/\b(vol\.?|volume|volumes|book)\s*[0-9]+.*$/i, "")
    .replace(/\b(chapter|chapters|ch\.)\s*[0-9]+.*$/i, "")            // manga is logged by chapter
    .replace(/\s*\(\d{4}\)\s*$/, "")                                  // trailing "(1991)"
    .replace(/\s+ft\..+$/i, "")                                       // "ft. Ed Brubaker"
    .replace(/[\s,:\-–]+$/, "")
    .trim();
  const base = out || c;
  if (!yearSensitive) return base;
  const year = volumeYear(c);
  return year && yearSensitive.has(keyOf(base)) ? `${base} (${year})` : base;
}

function volumeYear(comic: string): string | null {
  return /\((\d{4})\)/.exec(comic)?.[1] ?? null;
}

/**
 * Titles where a volume year is doing real work — the same title was written under two or
 * more different years, so folding them would put two different books on one page.
 *
 * Deliberately not "every heading with a year in it". 59 of the 4,353 headings carry one,
 * and preserving all of them would split 21 titles that are plainly a single run written
 * two ways ("Daredevil" and "Daredevil (1998)"). Today only Fantastic Four — 1961 and
 * 2022 — earns the split. Trading one wrong merge for twenty wrong splits is not a fix.
 */
export function yearSensitiveKeys(comics: string[]): Set<string> {
  const byTitle = new Map<string, Set<string>>();
  for (const c of comics) {
    const year = volumeYear(clean(c));
    if (!year) continue;
    const k = keyOf(normalizeSeries(c));
    let years = byTitle.get(k);
    if (!years) byTitle.set(k, (years = new Set()));
    years.add(year);
  }
  return new Set([...byTitle].filter(([, years]) => years.size > 1).map(([k]) => k));
}

/** Case, quotes and separators folded away. Shared by seriesKey and the year test. */
function keyOf(name: string): string {
  const key = name
    .toLowerCase()
    .replace(/[’‘ʼ']/g, "")       // apostrophes vanish, they don't become a word break:
                                  // "Dead Dog's Bite" and "Dead Dogs Bite" are one book
    .replace(/[^a-z0-9]+/g, " ")                 // every other separator becomes the same separator
    .trim();
  return key || name;
}

/**
 * Grouping key. Two headings share a series when they differ only in punctuation,
 * quote style or case — `Star Wars: Visions` and `Star Wars Visions` are one run.
 *
 * Deliberately conservative: it folds separators, never letters. `Monster`/`Monsters`,
 * `Black Magick`/`Black Magic` and `Haikyu!!`/`Haikyuu!!` stay apart, because a wrong
 * merge silently lies about which episodes discussed which book — worse than a duplicate.
 */
export function seriesKey(comic: string, yearSensitive?: ReadonlySet<string>): string {
  return keyOf(normalizeSeries(comic, yearSensitive));
}

/**
 * One spelling per group, chosen by how often each variant was actually written.
 * Ties break alphabetically so the build is reproducible.
 */
export function pickDisplayNames(names: string[], yearSensitive?: ReadonlySet<string>): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const raw of names) {
    const k = seriesKey(raw, yearSensitive);
    const display = normalizeSeries(raw, yearSensitive);
    if (!display) continue;
    let bucket = counts.get(k);
    if (!bucket) counts.set(k, (bucket = new Map()));
    bucket.set(display, (bucket.get(display) ?? 0) + 1);
  }
  const out = new Map<string, string>();
  for (const [k, bucket] of counts) {
    const best = [...bucket].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (best) out.set(k, best[0]);
  }
  return out;
}
