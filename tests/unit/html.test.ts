import { describe, expect, it } from "vitest";
import { esc, fmtDate, fmtRuntime, fmtShortDate, nf, pl } from "../../src/lib/html";

/**
 * `esc` is the single escaping boundary for every innerHTML in the codebase, and it had no
 * unit test at all. It guards every series name and comic title scraped out of show
 * notes — tests/unit/series.test.ts already proves fragments like
 * `Wonder Woman Special #1.</P><P><STRONG` reach the pipeline, and headings begin with a
 * quote character, which flows into `data-comic="…"`, `title="…"` and
 * `aria-label="Play … at …"` in views/components.ts. Every Playwright assertion on a
 * timestamp is a shape regex (/\d+:\d\d/), never a value, so the formatters were unheld too.
 */
describe("esc", () => {
  it("escapes all five characters that can break out of markup", () => {
    expect(esc(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });

  it("neutralises a real scraped heading rather than closing the attribute", () => {
    const scraped = `Wonder Woman Special #1.</P><P><STRONG`;
    const out = esc(scraped);
    expect(out).not.toMatch(/[<>]/);
    expect(out).toContain("&lt;/P&gt;");
  });

  it("escapes the quote that would end a data-comic attribute", () => {
    expect(esc(`"Awakening" Kickstarter`)).toBe("&quot;Awakening&quot; Kickstarter");
  });

  it("renders null and undefined as empty, not as the words", () => {
    expect(esc(null)).toBe("");
    expect(esc(undefined)).toBe("");
  });

  it("leaves ordinary text alone", () => {
    expect(esc("Ice Cream Man")).toBe("Ice Cream Man");
  });

  it("escapes every occurrence, not just the first", () => {
    expect(esc("<<")).toBe("&lt;&lt;");
  });
});

describe("pl", () => {
  it("is empty for exactly one and 's' otherwise, including zero", () => {
    expect(pl(1)).toBe("");
    expect(pl(0)).toBe("s");
    expect(pl(2)).toBe("s");
  });
});

describe("nf", () => {
  it("groups thousands the way every figure on the site is quoted", () => {
    expect(nf(4857)).toBe("4,857");
    expect(nf(0)).toBe("0");
  });
});

describe("fmtRuntime", () => {
  it("drops the hour field below 3600 and adds it above", () => {
    expect(fmtRuntime(1980)).toBe("33:00");
    expect(fmtRuntime(3599)).toBe("59:59");
    expect(fmtRuntime(3600)).toBe("1:00:00");
    expect(fmtRuntime(3753)).toBe("1:02:33");
  });

  it("pads minutes only once there is an hour, so 5:07 never reads as 05:07", () => {
    expect(fmtRuntime(307)).toBe("5:07");
    expect(fmtRuntime(3907)).toBe("1:05:07");
  });

  it("returns empty for the no-runtime cases rather than 0:00", () => {
    // The callers print "--:--" themselves; a formatted zero would look like a real stamp.
    expect(fmtRuntime(null)).toBe("");
    expect(fmtRuntime(0)).toBe("");
  });
});

describe("fmtDate", () => {
  it("formats a normalized ISO date", () => {
    expect(fmtDate("2026-08-05")).toBe("Aug 5, 2026");
    expect(fmtDate("2016-09-28")).toBe("Sep 28, 2016");
  });

  it("gives nothing for the 146 undated records", () => {
    expect(fmtDate(null)).toBe("");
  });

  it("gives nothing rather than 'undefined 1' for an unparseable month", () => {
    expect(fmtDate("2026-13-01")).toBe("");
  });
});

describe("fmtShortDate", () => {
  it("shortens to the tenure-strip form", () => {
    expect(fmtShortDate("2017-01-25")).toBe("Jan '17");
  });

  it("falls back to an em-dash pair, never to an empty cell", () => {
    expect(fmtShortDate(null)).toBe("——");
    expect(fmtShortDate("2017-99-01")).toBe("——");
  });
});
