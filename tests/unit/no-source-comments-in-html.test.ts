import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Views are functions that return HTML strings, so a `//` comment written inside a template
 * literal is not a comment at all — it is text, and it renders on the page. TypeScript cannot
 * see it, no view test asserts on the surrounding copy, and it reached production once:
 *
 *     <p>…Everybody gets a page.</p>
 *     // The alias note that sat here explained a data discrepancy no visitor asked about.
 *
 * That sat live on Panelists & Guests. This walks the source counting backticks, and flags any
 * `//` line that falls inside an open literal.
 */

const SRC = "src";

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return tsFiles(path);
    return e.isFile() && e.name.endsWith(".ts") ? [path] : [];
  });
}

function leaked(file: string): string[] {
  const found: string[] = [];
  let insideLiteral = false;

  readFileSync(file, "utf8").split("\n").forEach((line, i) => {
    if (insideLiteral && line.trim().startsWith("//")) {
      found.push(`${file}:${i + 1}  ${line.trim().slice(0, 70)}`);
    }
    // an odd number of unescaped backticks on a line opens or closes a literal
    const ticks = line.match(/(?<!\\)`/g)?.length ?? 0;
    if (ticks % 2) insideLiteral = !insideLiteral;
  });

  return found;
}

describe("HTML templates", () => {
  it("contain no source comments, which would render as page copy", () => {
    const found = tsFiles(SRC).flatMap(leaked);
    expect(found, "move these out of the template literal").toEqual([]);
  });

  it("the scanner can actually see one", () => {
    /* A guard that cannot fail is decoration. This proves the parity tracking works on the
       exact shape that shipped. */
    const sample = ["const html =", "  `<p>hello</p>", "  // a note", "  <div></div>`;"];
    let insideLiteral = false;
    const found: number[] = [];
    sample.forEach((line, i) => {
      if (insideLiteral && line.trim().startsWith("//")) found.push(i);
      const ticks = line.match(/(?<!\\)`/g)?.length ?? 0;
      if (ticks % 2) insideLiteral = !insideLiteral;
    });
    expect(found).toEqual([2]);
  });
});
