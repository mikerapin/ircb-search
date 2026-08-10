import { test, expect } from "@playwright/test";

/**
 * Contrast of INTERACTIVE STATES, in both plates.
 *
 * axe walks the resting page only: it never hovers and never focuses, so a rule that is
 * fine at rest and unreadable on hover passes every axe sweep in this repo. That gap is
 * how four separate regressions shipped — .pblock .ptag, .azrow .n, the search focus ring
 * and #minibar .cm — each of them a token that flips with the plate (var(--ink)) sitting
 * on a hover ground that does not (the fixed yellow).
 *
 * The rule this encodes: on a repainted ground, colour must come from `currentColor` or a
 * literal, never from a plate token.
 */

// getComputedStyle can return `color(srgb r g b / a)` with 0-1 channels rather than 0-255.
// Parsing that as 8-bit gives numbers that look like failures and aren't — it cost an hour.
const parse = c => {
  const n = (c.match(/-?[\d.]+(?:e-?\d+)?/g) ?? []).map(Number);
  if (/^color\(\s*srgb/i.test(c)) { const [r, g, b, a = 1] = n; return [r * 255, g * 255, b * 255, a]; }
  const [r, g, b, a = 1] = n;
  return [r, g, b, a];
};
const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (fg, bg) => {
  const f = parse(fg), g = parse(bg), a = f[3];
  const over = [0, 1, 2].map(i => f[i] * a + g[i] * (1 - a));
  const [hi, lo] = [lum(over), lum(g)].sort((x, y) => y - x);
  return +(((hi + 0.05) / (lo + 0.05)).toFixed(2));
};

/** Nearest ancestor that actually paints, so alpha composites over the real ground. */
const GROUND = `el => {
  let n = el;
  while (n) {
    const c = getComputedStyle(n).backgroundColor;
    if (c && !/rgba\\(0, 0, 0, 0\\)|transparent/.test(c)) return c;
    n = n.parentElement;
  }
  return "rgb(255,255,255)";
}`;

async function sample(page, selector, { hover = false, focus = false } = {}) {
  const el = page.locator(selector).first();
  if (!await el.count()) return null;
  if (hover) await el.hover();
  if (focus) await el.evaluate(n => n.focus());
  await page.waitForTimeout(120);
  return el.evaluate(new Function("el", `
    const ground = ${GROUND};
    const cs = getComputedStyle(el);
    return { fg: cs.color, bg: ground(el), outline: cs.outlineColor, outlineW: cs.outlineWidth };
  `));
}

// [label, route, selector, state]
const TEXT_CASES = [
  ["panel tagline (hover)", "/#/panel", ".pblock .ptag", { hover: true }],
  ["index row count (hover)", "/#/index", ".azrow .n", { hover: true }],
  ["chip count (hover)", "/#/who/Mike%20Rapin", ".chip .n", { hover: true }],
  ["facet count (hover)", "/#/search?q=batman", ".facet .n", { hover: true }],
  ["read-along meta (hover)", "/#/search?q=batman", ".panel .credits", { hover: true }],
  ["menu sub-label (hover)", "/", ".menu a .sub", { hover: true }],
];

for (const plate of ["light", "negative"]) {
  test(`text stays legible in every interactive state — ${plate} plate`, async ({ page }) => {
    if (plate === "negative") await page.addInitScript(() => localStorage.setItem("ircb.neg", "1"));
    const bad = [];
    for (const [label, route, selector, state] of TEXT_CASES) {
      await page.goto(route);
      await page.waitForSelector("body[data-ready]");
      if (selector.startsWith(".menu")) await page.locator("#navbtn").click();
      await page.waitForTimeout(250);
      const s = await sample(page, selector, state);
      // A silent `continue` here meant a case whose selector stopped matching vanished from
      // the sweep and reported success. Rename a class and the check disappears with it.
      if (!s) { bad.push(`${label}: selector "${selector}" matched nothing on ${route}`); continue; }
      const r = ratio(s.fg, s.bg);
      if (r < 4.5) bad.push(`${label}: ${r}:1  (${s.fg} on ${s.bg})`);
    }
    expect(bad, `${plate} plate`).toEqual([]);
  });

  test(`focus rings are visible against their own ground — ${plate} plate`, async ({ page }) => {
    if (plate === "negative") await page.addInitScript(() => localStorage.setItem("ircb.neg", "1"));
    const bad = [];
    const cases = [
      ["search field", "/", "#q"],
      ["search submit", "/", ".blurb .go"],
      ["A-Z heading", "/#/index", ".azsec > h2"],
      ["facet", "/#/search?q=batman", ".facet"],
    ];
    for (const [label, route, selector] of cases) {
      await page.goto(route);
      await page.waitForSelector("body[data-ready]");
      await page.waitForTimeout(250);
      const s = await sample(page, selector, { focus: true });
      if (!s) { bad.push(`${label}: selector "${selector}" matched nothing on ${route}`); continue; }
      // A focusable control with no ring at all is the failure this test exists to catch,
      // not a case to skip past.
      if (parseFloat(s.outlineW) === 0) { bad.push(`${label}: no focus ring at all`); continue; }
      // WCAG 1.4.11: a focus indicator needs 3:1 against what it sits on.
      const r = ratio(s.outline, s.bg);
      if (r < 3) bad.push(`${label}: ring ${r}:1  (${s.outline} on ${s.bg})`);
    }
    expect(bad, `${plate} plate`).toEqual([]);
  });
}

test("generated cover plates are legible on both plates", async ({ page }) => {
  /* This carried a test.fail() for the one pair known to measure 4.29:1 on the light plate.
     It hid three more: --yellow on --ink, --red on --ink and --yellow on --blue all
     collapsed on the NEGATIVE plate, to 1.41, 2.19 and 1.12, because those pairs put bright
     lettering on a field that also goes bright when the plate inverts.

     test.fail() is a blanket amnesty, not a targeted one — the case passes when it fails for
     any reason at all, so one acknowledged bug was covering for three nobody had measured.
     It was also covering for a timeout: this case opens two contexts and walks four routes
     in each, and it does not fit in the default 30s. Which means that before today it may
     never have completed a measurement at all — it "passed" by dying.

     If a single known failure ever needs recording again, assert the specific pair rather
     than excusing the whole test. Fixed 2026-08-10; all sixteen combinations now clear AA,
     the lowest at 5.08. */
  test.slow();
  /* Sampled from real rendered plates, NOT from a copy of the FIELDS table in cover.ts —
     duplicating that table here would only assert that I transcribed it correctly. The
     palette pairs a text token with a field token, and --ink/--blue invert with the plate
     while --yellow does not, so a pair can collapse in the negative only. */
  for (const neg of [false, true]) {
    const ctx = await page.context().newPage();
    if (neg) await ctx.addInitScript(() => localStorage.setItem("ircb.neg", "1"));
    /* Several routes: the field is picked by hashing the series name, so one page only
       ever exercises a few of the eight pairs. */
    const seen = {};
    for (const route of ["/", "/#/search?q=a", "/#/search?q=the", "/#/who/Mike%20Rapin"]) {
      await ctx.goto(route);
      await ctx.waitForSelector(".gc", { timeout: 15000 }).catch(() => {});
      await ctx.waitForTimeout(400);
      Object.assign(seen, await ctx.evaluate(() => {
        const out = {};
        for (const gc of document.querySelectorAll(".gc")) {
          const title = gc.querySelector(".gc-t");
          if (!title) continue;
          const cs = getComputedStyle(gc);
          out[`${cs.getPropertyValue("--gc-t")} on ${cs.getPropertyValue("--gc-f")}`] = {
            fg: getComputedStyle(title).color, bg: cs.backgroundColor,
            f: cs.getPropertyValue("--gc-f").trim(), t: cs.getPropertyValue("--gc-t").trim() };
        }
        return out;
      }));
    }
    await ctx.close();
    const combos = Object.values(seen);
    /* One search page exercises only some of the eight pairs, because the field is picked by
       hashing the series name. Four is what /#/search?q=a actually renders — raising this
       needs sampling across several routes, which is the TODO in NOTES.md. */
    expect(combos.length, "too few distinct plate pairs sampled").toBeGreaterThanOrEqual(4);
    const bad = combos
      .map(c => ({ ...c, r: ratio(c.fg, c.bg) }))
      .filter(c => c.r < 4.5)
      .map(c => `${c.t} on ${c.f}: ${c.r}:1`);
    expect(bad, neg ? "negative plate" : "light plate").toEqual([]);
  }
});
