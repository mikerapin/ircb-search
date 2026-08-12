import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * The Wall is a calendar, so the thing worth asserting hardest is what is NOT on it: an
 * episode with no air date has no square, because there is nowhere honest to put it.
 */

const data = page => page.evaluate(() => fetch("d/core.json").then(r => r.json()));

test("a square for every dated episode, and none for the undated", async ({ page }) => {
  await page.goto("/#/wall");
  await page.waitForSelector(".cell");
  const core = await data(page);
  const dated = core.episodes.filter(e => e.date);

  await expect(page.locator(".cell")).toHaveCount(dated.length);
  expect(dated.length).toBeLessThan(core.stats.episodes);   // there really are undated ones

  // ...and the legend says how many are missing rather than leaving it to be noticed.
  await expect(page.locator(".walllegend")).toContainText(
    String(core.stats.episodes - dated.length));

  const keys = await page.locator(".cell").evaluateAll(els => els.map(e => e.dataset.cell));
  const undated = new Set(core.episodes.filter(e => !e.date).map(e => e.key));
  expect(keys.filter(k => undated.has(k))).toEqual([]);
});

test("the ink ramp actually varies with how many comics were logged", async ({ page }) => {
  await page.goto("/#/wall");
  await page.waitForSelector(".cell");
  const buckets = await page.locator(".cell").evaluateAll(els => {
    const out = {};
    for (const e of els) {
      const m = e.className.match(/\bn(\d)\b/);
      if (m) out[m[1]] = (out[m[1]] ?? 0) + 1;
    }
    return out;
  });
  // A ramp that collapsed to one bucket would still look like a wall and mean nothing.
  expect(Object.keys(buckets).length).toBeGreaterThan(2);

  // n0 is its own state: no comics logged, not "a few".
  const core = await data(page);
  const none = core.episodes.filter(e => e.date && !e.mentionCount).length;
  expect(buckets["0"] ?? 0).toBe(none);
});

test("years group in order and the counts on each row are real", async ({ page }) => {
  await page.goto("/#/wall");
  await page.waitForSelector(".yrow");
  const rows = await page.locator(".yrow").evaluateAll(els => els.map(el => ({
    year: el.querySelector(".ylab").firstChild.textContent.trim(),
    label: Number((el.querySelector(".cnt").textContent.match(/\d+/) ?? [0])[0]),
    cells: el.querySelectorAll(".cell").length,
  })));
  expect(rows.length).toBeGreaterThan(1);
  // Reverse chronological: newest year at the top.
  expect(rows.map(r => r.year)).toEqual([...rows.map(r => r.year)].sort().reverse());
  for (const r of rows) expect(r.label, `row ${r.year}`).toBe(r.cells);

  /* Only the stack of years reversed. Inside a row the run still reads left to right,
     oldest first — check it against the dates, not the rendering. */
  const keys = await page.locator(".yrow").first().locator(".cell").evaluateAll(els =>
    els.map(e => e.dataset.cell));
  const core = await data(page);
  const dateOf = new Map(core.episodes.map(e => [e.key, e.date]));
  const dates = keys.map(k => dateOf.get(k));
  expect(dates.length).toBeGreaterThan(1);
  expect(dates).toEqual([...dates].sort());
});

test("searching lights the wall instead of filtering it away", async ({ page }) => {
  await page.goto("/#/wall");
  await page.waitForSelector("#wrack .wchip");        // the rack means mentions have landed
  const total = await page.locator(".cell").count();

  await page.locator("#ignite").fill("batman");
  await expect(page.locator("#wall")).toHaveClass(/\blit\b/);
  const hits = await page.locator(".cell.hit").count();
  expect(hits).toBeGreaterThan(0);
  expect(hits).toBeLessThan(total);
  // Every square stays on the page — dimmed, not removed. That is the whole idea.
  await expect(page.locator(".cell")).toHaveCount(total);
  await expect(page.locator("#resline")).toContainText(String(hits));

  await page.locator("[data-act=wclear]").click();
  await expect(page.locator("#wall")).not.toHaveClass(/\blit\b/);
});

test("a rack chip's number is what clicking it actually lights", async ({ page }) => {
  /* The count used to be "episodes carrying that exact series", while the click ran a text
     search — so Saga's chip said 15 and lit 21, because "Saga" also matches "Saga:
     Compendium One". Same defect the search facets already have a test for. */
  await page.goto("/#/wall");
  await page.waitForSelector("#wrack .wchip");
  const chip = page.locator("#wrack .wchip").first();
  const claimed = Number((await chip.locator("b").innerText()).replace(/,/g, ""));
  await chip.click();
  await expect(page.locator("#wall")).toHaveClass(/\blit\b/);
  expect(await page.locator(".cell.hit").count()).toBe(claimed);
});

test("a panelist filter needs no comic data and marks itself pressed", async ({ page }) => {
  await page.goto("/#/wall");
  await page.waitForSelector(".cell");
  const face = page.locator(".ribbon .pface").first();
  const who = await face.getAttribute("data-who");
  await face.click();
  await expect(face).toHaveAttribute("aria-pressed", "true");

  const hits = await page.locator(".cell.hit").count();
  const core = await data(page);
  // Panel membership lives in core.json, so this must work whether or not mentions loaded.
  const expected = core.episodes.filter(e => e.date && e.people.includes(who)).length;
  expect(hits).toBe(expected);

  await face.click();
  await expect(face).toHaveAttribute("aria-pressed", "false");
});

test("a square opens the episode in the rail, and the rail closes cleanly", async ({ page }) => {
  await page.goto("/#/wall");
  await page.waitForSelector("#wrack .wchip");
  await page.locator(".cell").first().click();

  await expect(page.locator("#rail")).toBeVisible();
  await expect(page.locator("#railbody h2")).not.toBeEmpty();
  await expect(page.locator("#railbody a[href^='#/ep/']").first()).toBeVisible();

  /* The close button has to actually be clickable. `.pricebox` is position:absolute, and the
     rail rendered it with no positioned box to pin to, so it resolved against #rail and sat
     exactly on top of this button — every click bounced off the runtime badge. Only showed
     up once the newest year moved to the top, because the 2015 episodes it used to click
     carry no runtime and so rendered no badge at all. */
  await page.locator("#rail-x").click({ timeout: 5000 });
  await expect(page.locator("#rail")).toBeHidden();
  // Hiding a container that holds focus strands the reader on <body>.
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("view");
});

test("?e= centres a square and fires the arrival cue once", async ({ page }) => {
  await page.goto("/#/wall");
  await page.waitForSelector(".cell");
  const key = await page.locator(".cell").nth(200).getAttribute("data-cell");

  await page.goto("/#/wall?e=" + encodeURIComponent(key));
  const cell = page.locator(`.cell[data-cell="${key}"]`);
  await expect(cell).toHaveClass(/\bcurrent\b/);
  // The swirl is one-time: it plays and removes itself, leaving the steady outline.
  await expect(cell).not.toHaveClass(/\bspot\b/, { timeout: 5000 });
  await expect(page.locator("#rail")).toBeVisible();
});

test("no sideways scroll at 390, and the phone grid is the 13-column one", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/wall");
  await page.waitForSelector(".cell");
  expect(await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  const cols = await page.evaluate(() =>
    getComputedStyle(document.querySelector(".ycells")).gridTemplateColumns.split(" ").length);
  expect(cols).toBe(13);
});

test("the wall is axe clean on both plates with no console errors", async ({ page }) => {
  for (const neg of [false, true]) {
    const ctx = await page.context().newPage();
    if (neg) await ctx.addInitScript(() => localStorage.setItem("ircb.neg", "1"));
    const errors = [];
    ctx.on("pageerror", e => errors.push(String(e)));
    await ctx.goto("/#/wall");
    await ctx.waitForSelector("#wrack .wchip");
    const axe = await new AxeBuilder({ page: ctx }).analyze();
    expect(axe.violations, neg ? "negative plate" : "light plate").toEqual([]);
    expect(errors).toEqual([]);
    await ctx.close();
  }
});

test("the rail overlays the wall instead of shoving it sideways", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/wall");
  await page.waitForSelector("#wrack .wchip");

  const box = sel => page.locator(sel).first().evaluate(el => {
    const r = el.getBoundingClientRect();
    return { left: Math.round(r.left), width: Math.round(r.width) };
  });
  const before = { head: await box(".dress"), grid: await box("#wall"), foot: await box("footer") };

  await page.locator(".cell").first().click();
  await expect(page.locator("#rail")).toBeVisible();
  const after = { head: await box(".dress"), grid: await box("#wall"), foot: await box("footer") };

  /* `padding-right` on <body> reserved a column for the rail, so opening one square moved
     the header, the wall and the footer. Nothing outside the rail may move. */
  expect(after).toEqual(before);

  /* Non-modal, and that is the point of the overlay: the wall underneath stays live, so a
     reader walks square to square and the rail follows without a close in between. The
     scrim is `inset:0` at z-index 90, so what matters is whether it swallows clicks —
     `toBeVisible` would not tell us, since Playwright counts an opacity:0 element as
     visible. Read the computed style, then prove it by clicking through. */
  expect(await page.locator(".scrim").evaluate(el => {
    const cs = getComputedStyle(el);
    return { opacity: cs.opacity, pointerEvents: cs.pointerEvents };
  })).toEqual({ opacity: "0", pointerEvents: "none" });
  const second = page.locator(".cell").nth(40);
  const key = await second.getAttribute("data-cell");
  await second.click();
  await expect(page.locator("#rail")).toBeVisible();
  await expect(page.locator(`#railbody a[href="#/ep/${encodeURIComponent(key)}"]`).first()).toBeVisible();
});

test("the rail lists its markers rather than sliding them sideways", async ({ page }) => {
  await page.goto("/#/wall");
  await page.waitForSelector("#wrack .wchip");
  // The saved episode-page preference must not follow the reader into a 392px column.
  await page.evaluate(() => localStorage.setItem("ircb.readalong", "strip"));
  await page.reload();
  await page.waitForSelector("#wrack .wchip");

  /* Pick a square with comics logged, or the rail renders the "nobody indexed this" line
     and there is no layout to judge. */
  const key = await page.evaluate(async () => {
    const core = await fetch("d/core.json").then(r => r.json());
    return core.episodes.filter(e => e.date && e.mentionCount > 2)
      .sort((a, b) => b.mentionCount - a.mentionCount)[0].key;
  });
  // No CSS.escape here — this runs in node, not the browser. A quoted attribute value
  // handles the `:` and `|` in a synthetic episode key on its own.
  await page.locator(`.cell[data-cell="${key}"]`).click();
  await expect(page.locator("#railbody .ra-list")).toBeVisible();
  await expect(page.locator("#railbody .ra-strip")).toHaveCount(0);

  // A horizontal scroller in a 392px panel is the thing being fixed.
  const overflows = await page.locator("#railbody").evaluate(el => el.scrollWidth > el.clientWidth + 1);
  expect(overflows, "the rail scrolls sideways").toBe(false);
});

test("the drawer locks the page behind it on mobile, and does not on desktop", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/wall");
  await page.waitForSelector("#wrack .wchip");

  // Get some scroll range under us, then open the drawer from where we are.
  await page.mouse.wheel(0, 900);
  await page.waitForFunction(() => window.scrollY > 100, null, { timeout: 10000 });

  /* Click a square that is ALREADY on screen, from inside the page. `locator.click()` scrolls
     its target into view first, which moved the page out from under this test before the lock
     even ran — the lock then correctly captured the new position and the assertion compared
     against the old one. */
  const before = await page.evaluate(() => {
    const onScreen = [...document.querySelectorAll(".cell")].find(c => {
      const r = c.getBoundingClientRect();
      return r.top > 120 && r.bottom < window.innerHeight - 60;
    });
    if (!onScreen) throw new Error("no square on screen to click");
    // Read first: the click handler is synchronous, so it locks the page — and a locked
    // <body> reports scrollY 0 — before this function could return.
    const y = window.scrollY;
    onScreen.click();
    return y;
  });
  expect(before).toBeGreaterThan(100);
  await expect(page.locator("#rail")).toBeVisible();

  /* The scrim covered the page but did not stop it moving — a drag outside the sheet
     scrolled the wall behind it. Assert on where the wall SITS, not on window.scrollY:
     the lock pins <body>, so scrollY reads 0 while it holds and would "pass" for a page
     that had been thrown back to the top, which is the bug the first attempt introduced. */
  const wallTop = () => page.locator("#wall").evaluate(el => Math.round(el.getBoundingClientRect().top));
  const parkedAt = await wallTop();
  await page.mouse.wheel(0, 800);
  await page.waitForTimeout(300);
  expect(await wallTop(), "the wall moved behind the open sheet").toBe(parkedAt);

  // ...and it has to give the reader their place back, exactly.
  await page.locator("#rail-x").click();
  await expect(page.locator("#rail")).toBeHidden();
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
  await page.mouse.wheel(0, 400);
  await page.waitForFunction(y => window.scrollY > y, before, { timeout: 10000 });

  /* Desktop is deliberately the opposite: the rail is non-modal there, so the wall must
     stay scrollable with it open or you cannot reach the squares it is covering. */
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/wall");
  await page.waitForSelector("#wrack .wchip");
  /* `goto` to the same hash URL is a same-document navigation, so the scroll position from
     the mobile half above survives it — and at 1440 the page is short enough that it landed
     at max scroll, leaving nothing to move and making the assertion below unfalsifiable. */
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.locator(".cell").first().click();
  await expect(page.locator("#rail")).toBeVisible();
  const deskBefore = await page.evaluate(() => window.scrollY);
  await page.mouse.wheel(0, 800);
  await page.waitForFunction(y => window.scrollY > y, deskBefore, { timeout: 10000 });
});

test("the rail names the date once, not again under every marker", async ({ page }) => {
  await page.goto("/#/wall");
  await page.waitForSelector("#wrack .wchip");
  const key = await page.evaluate(async () => {
    const core = await fetch("d/core.json").then(r => r.json());
    return core.episodes.filter(e => e.date && e.mentionCount > 3)
      .sort((a, b) => b.mentionCount - a.mentionCount)[0].key;
  });
  await page.locator(`.cell[data-cell="${key}"]`).click();
  await page.waitForSelector("#railbody .ra-list");

  // The railhead states it, once, above the list.
  const stated = (await page.locator("#railk").innerText()).trim();
  expect(stated).toMatch(/\d{4}/);

  /* Every row is the same episode, so repeating its date under each comic is noise — the
     same reason the search card turned `withDate` off. The rows still carry their segment
     when they have one, which is why this asserts on the date and not on `.mt` existing. */
  const metas = await page.locator("#railbody .ra-row .mt").allInnerTexts();
  for (const m of metas) {
    expect(m.toLowerCase(), "a marker row repeats the date the railhead already gave")
      .not.toContain(stated.toLowerCase());
  }
});
