import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// The popover is #ta with .ta-grp headers and .ta-opt links — the plan's .typeahead
// was an approximation; the prototype's markup is the authority.

test("slash opens, groups render, keyboard completes", async ({ page }) => {
  await page.goto("/");
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
  await page.keyboard.press("/");
  await expect(page.locator("#ta")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#ta")).toBeHidden();
});

test("empty box offers a starting point", async ({ page }) => {
  await page.goto("/");
  await page.locator("#q").focus();
  await expect(page.locator("#ta .ta-grp", { hasText: /Start here/ })).toBeVisible();
  await expect(page.locator("#ta .ta-opt").first()).toBeVisible();
});

test("submitting the form goes to full search", async ({ page }) => {
  await page.goto("/");
  await page.locator("#q").fill("batman");
  await page.locator("#q").press("Enter");
  await expect(page).toHaveURL(/#\/search\?q=batman/);
});

test("slash is ignored while typing in a field", async ({ page }) => {
  await page.goto("/");
  await page.locator("#q").focus();
  await page.keyboard.press("Escape");
  await page.locator("#q").fill("a/b");
  await expect(page.locator("#q")).toHaveValue("a/b");
});

test("typeahead is axe clean with the popover open", async ({ page }) => {
  const errors = [];
  page.on("pageerror", e => errors.push(e));
  await page.goto("/");
  await page.keyboard.press("/");
  await page.keyboard.type("saga");
  await expect(page.locator("#ta .ta-foot")).toBeVisible();
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
  expect(errors).toEqual([]);
});
