import { describe, expect, it } from "vitest";
import { azBuckets } from "../../src/lib/az";

/**
 * The Index and the panel directory share this, and it had no unit test — the "#" bucket
 * that digit- and symbol-leading headings depend on was only ever asserted through a
 * rendered page, where a missing bucket looks like a missing row.
 */
const names = (s: string): string => s;

describe("azBuckets", () => {
  it("files digit-leading headings under #", () => {
    // Ten real headings depend on this: "007", "2000 AD Prog 2368", "4 Kids Walk Into a
    // Bank", "20th Century Men" and the rest.
    const out = azBuckets(["2000 AD", "1602", "007", "Saga"], names);
    expect(out[0]?.letter).toBe("#");
    expect(out[0]?.rows).toEqual(["007", "1602", "2000 AD"]);
  });

  it("files a heading with no letter or digit at all under #", () => {
    const out = azBuckets(["!!!", "Saga"], names);
    expect(out[0]).toEqual({ letter: "#", rows: ["!!!"] });
  });

  it("sorts # first, ahead of every letter", () => {
    const out = azBuckets(["Saga", "2000 AD", "Batman"], names);
    expect(out.map(b => b.letter)).toEqual(["#", "B", "S"]);
  });

  it("takes the first alphanumeric, not the first character", () => {
    /* All 21 symbol-leading headings in the index file under their first *letter*, not
       under "#" — `“Awakening” Kickstarter` is an A and `…And Then Emily Was Gone` is an A
       too. A naive charAt(0) would bury every one of them in "#". */
    const out = azBuckets(["“Awakening” Kickstarter", "…And Then Emily Was Gone",
      "(The) Wicked + The Divine", "!Murderer"], names);
    expect(out.map(b => b.letter)).toEqual(["A", "M", "T"]);
    expect(out[0]?.rows).toHaveLength(2);
  });

  it("folds case into one bucket", () => {
    const out = azBuckets(["saga", "Saga: Compendium One"], names);
    expect(out).toHaveLength(1);
    expect(out[0]?.letter).toBe("S");
    expect(out[0]?.rows).toHaveLength(2);
  });

  it("sorts rows inside a bucket by their name, not by input order", () => {
    const out = azBuckets(["Batman: Year One", "Batgirl", "Batman"], names);
    expect(out[0]?.rows).toEqual(["Batgirl", "Batman", "Batman: Year One"]);
  });

  it("keeps every item — the buckets partition the input", () => {
    const input = ["Saga", "2000 AD", "!!!", "zzz", "Batman"];
    const out = azBuckets(input, names);
    expect(out.flatMap(b => b.rows).sort()).toEqual([...input].sort());
  });

  it("reads the name through nameOf rather than assuming a string", () => {
    const rows = [{ name: "Saga", n: 3 }, { name: "1602", n: 1 }];
    const out = azBuckets(rows, r => r.name);
    expect(out.map(b => b.letter)).toEqual(["#", "S"]);
    expect(out[0]?.rows[0]?.n).toBe(1);
  });

  it("returns nothing for no items", () => {
    expect(azBuckets([], names)).toEqual([]);
  });
});
