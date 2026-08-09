import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// The popover is #ta with .ta-grp headers and .ta-opt links — the plan's .typeahead
// was an approximation; the prototype's markup is the authority.
//
// Each test waits for body[data-ready]: main.ts wires the search band after the load event
// on a cold start, so pressing / any earlier hits a page with no listeners attached yet.

test("slash opens, groups render, keyboard completes", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("body[data-ready]");
  await page.keyboard.press("/");
  await page.keyboard.type("saga");
  const pop = page.locator("#ta");
  await expect(pop.locator(".ta-grp", { hasText: /^Series$/ })).toBeVisible();
  await expect(pop.locator(".ta-foot")).toContainText(/mentions? match · [\d,]+ you can jump to/);
  await page.keyboard.press("ArrowDown");
  await expect(pop.locator(".ta-opt.act")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/(series|search|ep|who)/);
});

test("escape closes", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("body[data-ready]");
  await page.keyboard.press("/");
  await expect(page.locator("#ta")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#ta")).toBeHidden();
});

test("empty box offers a starting point", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("body[data-ready]");
  await page.locator("#q").focus();
  await expect(page.locator("#ta .ta-grp", { hasText: /Start here/ })).toBeVisible();
  await expect(page.locator("#ta .ta-opt").first()).toBeVisible();
});

test("submitting the form goes to full search", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("body[data-ready]");
  await page.locator("#q").fill("batman");
  await page.locator("#q").press("Enter");
  await expect(page).toHaveURL(/#\/search\?q=batman/);
});

test("slash is ignored while typing in a field", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("body[data-ready]");
  await page.locator("#q").focus();
  await page.keyboard.press("Escape");
  await page.locator("#q").fill("a/b");
  await expect(page.locator("#q")).toHaveValue("a/b");
});

test("typeahead is axe clean with the popover open", async ({ page }) => {
  const errors = [];
  page.on("pageerror", e => errors.push(e));
  await page.goto("/");
  await page.waitForSelector("body[data-ready]");
  await page.keyboard.press("/");
  await page.keyboard.type("saga");
  await expect(page.locator("#ta .ta-foot")).toBeVisible();
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
  expect(errors).toEqual([]);
});

test("the popover is a real combobox, not a div of links", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("body[data-ready]");
  const box = page.locator("#q");

  await expect(box).toHaveAttribute("role", "combobox");
  await expect(box).toHaveAttribute("aria-controls", "ta");
  await expect(box).toHaveAttribute("aria-expanded", "false");

  await box.click();
  await expect(page.locator("#ta")).toBeVisible();
  await expect(box).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#ta")).toHaveAttribute("role", "listbox");

  // Every direct child is either an option with an id, or explicitly presentational —
  // a bare div inside a listbox is announced as a choice the user cannot make.
  const kids = await page.locator("#ta > *").evaluateAll(els =>
    els.map(e => ({ role: e.getAttribute("role"), id: e.id, opt: e.classList.contains("ta-opt") })));
  expect(kids.length).toBeGreaterThan(0);
  for (const k of kids) {
    if (k.opt) { expect(k.role).toBe("option"); expect(k.id).toMatch(/^ta-opt-\d+$/); }
    else expect(k.role).toBe("presentation");
  }

  // Arrow keys move the active option via activedescendant, with focus staying in the field.
  await page.keyboard.press("ArrowDown");
  const active = await box.getAttribute("aria-activedescendant");
  expect(active).toMatch(/^ta-opt-\d+$/);
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("q");
  await expect(page.locator("#" + active)).toHaveAttribute("aria-selected", "true");

  // Escape closes the popover but leaves the user in the field they were typing in.
  await page.keyboard.press("Escape");
  await expect(page.locator("#ta")).toBeHidden();
  await expect(box).toHaveAttribute("aria-expanded", "false");
  expect(await box.getAttribute("aria-activedescendant")).toBeNull();
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("q");
});
