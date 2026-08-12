import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

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
type Rgba = [number, number, number, number];

const parse = (c: string): Rgba => {
  const n = (c.match(/-?[\d.]+(?:e-?\d+)?/g) ?? []).map(Number);
  const [r = 0, g = 0, b = 0, a = 1] = n;
  if (/^color\(\s*srgb/i.test(c)) return [r * 255, g * 255, b * 255, a];
  return [r, g, b, a];
};
const lin = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]: Rgba) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
/**
 * `opacity` is the second way text fades, and for a long time this harness could not see it.
 * It composited the colour's own alpha and read `cs.color`, which element opacity does not
 * change — so a rule like `.menu a:hover .sub{opacity:.78}` rendered at 78% of a colour that
 * was already `color-mix(...75%)` and measured as though it were at full strength. That is
 * why the standing rule is color-mix over opacity: color-mix puts the fade somewhere this
 * can measure. Fold it in so the rule is enforced rather than merely written down.
 */
const ratio = (fg: string, bg: string, opacity = 1) => {
  const f = parse(fg), g = parse(bg), a = f[3] * opacity;
  const over = [0, 1, 2].map(i => (f[i] as number) * a + (g[i] as number) * (1 - a)) as unknown as Rgba;
  const [hi = 0, lo = 0] = [lum(over), lum(g)].sort((x, y) => y - x);
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

interface Swatch { fg: string; bg: string; opacity: number; px: number;
                   outline: string; outlineW: string }

async function sample(page: Page, selector: string,
                      { hover = false, focus = false }: TextState = {}): Promise<Swatch | null> {
  const el = page.locator(selector).first();
  if (!await el.count()) return null;
  if (hover) await el.hover();
  if (focus) await el.evaluate(n => n.focus());
  await page.waitForTimeout(120);
  return el.evaluate(new Function("el", `
    const ground = ${GROUND};
    const cs = getComputedStyle(el);
    /* Multiply every opacity between the text and the box that paints its ground. Stopping
       at the ground is deliberate: an opacity further up fades the background with the text
       and does not reduce the contrast between them. */
    let opacity = 1;
    for (let n = el; n; n = n.parentElement) {
      const s = getComputedStyle(n);
      const o = Number(s.opacity);
      if (Number.isFinite(o)) opacity *= o;
      const b = s.backgroundColor;
      if (n !== el && b && !/rgba\\(0, 0, 0, 0\\)|transparent/.test(b)) break;
    }
    return { fg: cs.color, bg: ground(el), outline: cs.outlineColor, outlineW: cs.outlineWidth,
             opacity, px: parseFloat(cs.fontSize) };
  `) as unknown as (el: SVGElement | HTMLElement) => Swatch);
}

// [label, route, selector, state]
interface TextState { hover?: boolean; focus?: boolean }
type TextCase = [label: string, route: string, selector: string, state?: TextState];

const TEXT_CASES: TextCase[] = [
  ["panel tagline (hover)", "/#/panel", ".pblock .ptag", { hover: true }],
  ["index row count (hover)", "/#/index", ".azrow .n", { hover: true }],
  ["chip count (hover)", "/#/who/Mike%20Rapin", ".chip .n", { hover: true }],
  ["facet count (hover)", "/#/search?q=batman", ".facet .n", { hover: true }],
  ["read-along meta (hover)", "/#/search?q=batman", ".panel .credits", { hover: true }],
  ["menu sub-label (hover)", "/", ".menu a .sub", { hover: true }],
  /* The three element-opacity survivors of Task 5. Each compounds `opacity` on top of a
     colour that is already mixed toward the ground, and each sits on text under 13px. */
  ["menu sub-label (rest)", "/", ".menu a .sub", {}],
  ["masthead micro", "/", ".dress-meta .micro", {}],
  ["typeahead meta (hover)", "/", ".ta-opt .mt", { hover: true }],
  /* The read-along row repaints to the fixed yellow on hover and fades three labels with
     `opacity:.85` — the same shape as the two above, on 10px and 10.5px type. */
  ["read-along cue (hover)", "/#/search?q=batman", ".ra-row .cue", { hover: true }],
  /* `.mt` is in the same declaration as these two — same colour, same opacity, same
     repainted ground — so its ratio is theirs. It is not listed because it does not render
     on a search card (no segment, and the card states the date once at the top), and a case
     whose selector matches nothing is a reported failure here, not a silent skip. */
  ["read-along stamp (hover)", "/#/search?q=batman", ".ra-row .t", { hover: true }],
];

for (const plate of ["light", "negative"]) {
  test(`text stays legible in every interactive state — ${plate} plate`, async ({ page }) => {
    if (plate === "negative") await page.addInitScript(() => localStorage.setItem("ircb.neg", "1"));
    const bad: string[] = [];
    for (const [label, route, selector, state] of TEXT_CASES) {
      await page.goto(route);
      await page.waitForSelector("body[data-ready]");
      if (selector.startsWith(".menu")) await page.locator("#navbtn").click();
      if (selector.startsWith(".ta-opt")) {
        await page.locator("#q").fill("batman");
        await page.waitForSelector(".ta-opt", { timeout: 15000 });
      }
      await page.waitForTimeout(250);
      const s = await sample(page, selector, state);
      // A silent `continue` here meant a case whose selector stopped matching vanished from
      // the sweep and reported success. Rename a class and the check disappears with it.
      if (!s) { bad.push(`${label}: selector "${selector}" matched nothing on ${route}`); continue; }
      const r = ratio(s.fg, s.bg, s.opacity);
      if (r < 4.5) {
        const fade = s.opacity < 1 ? `, opacity ${s.opacity.toFixed(2)}` : "";
        bad.push(`${label}: ${r}:1  (${s.fg} on ${s.bg}${fade}, ${s.px}px)`);
      }
    }
    expect(bad, `${plate} plate`).toEqual([]);
  });

  test(`focus rings are visible against their own ground — ${plate} plate`, async ({ page }) => {
    if (plate === "negative") await page.addInitScript(() => localStorage.setItem("ircb.neg", "1"));
    const bad: string[] = [];
    const cases: [label: string, route: string, selector: string][] = [
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
        const out: Record<string, { fg: string; bg: string; f: string; t: string }> = {};
        for (const gc of document.querySelectorAll<HTMLElement>(".gc")) {
          const title = gc.querySelector<HTMLElement>(".gc-t");
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
    const combos = Object.values(seen) as { fg: string; bg: string; f: string; t: string }[];
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
