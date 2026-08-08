export interface AzBucket<T> { letter: string; rows: T[] }

/**
 * A–Z buckets with digits and symbols under "#", rows sorted inside each. Shared by the
 * Index (series headings) and the panel directory (guest names).
 */
export function azBuckets<T>(items: T[], nameOf: (item: T) => string): AzBucket<T>[] {
  const by = new Map<string, T[]>();
  for (const item of items) {
    let ch = (nameOf(item).match(/[A-Za-z0-9]/)?.[0] ?? "#").toUpperCase();
    if (/[0-9]/.test(ch)) ch = "#";
    let list = by.get(ch);
    if (!list) by.set(ch, (list = []));
    list.push(item);
  }
  for (const list of by.values()) list.sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  return [...by.keys()].sort().map(letter => ({ letter, rows: by.get(letter) ?? [] }));
}
