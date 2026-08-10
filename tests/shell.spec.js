import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("shell renders and nav works", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("body[data-ready]");
  await expect(page.locator("header .logo")).toBeVisible();
  await page.getByRole("button", { name: /open menu/i }).click();
  // Menu entries carry a subtitle span, so the accessible name is "About the Data What is indexed".
  await page.getByRole("link", { name: /About the Data/ }).click();
  await expect(page).toHaveURL(/#\/about/);
  await expect(page.locator("#menu")).toBeHidden();
});

test("dress label and footer counts come from the data", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("body[data-ready]");
  await expect(page.locator("#dressno")).toHaveText(/^EP\. \d{3}$/);
  // Not "timestamped": most logged comics carry no minute, so the indicia says "mentions".
  await expect(page.locator("#foot-legal")).toContainText(/\d[\d,]* episodes and [\d,]+ comic mentions/);
});

test("skip link focuses contents without hijacking the route", async ({ page }) => {
  await page.goto("/#/about");
  await page.waitForSelector("body[data-ready]");
  await page.keyboard.press("Tab");
  await page.getByRole("link", { name: /skip to contents/i }).press("Enter");
  await expect(page).toHaveURL(/#\/about/);
  await expect(page.locator("#view")).toBeFocused();
});

test("negative toggle flips the plate", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("body[data-ready]");
  await page.getByRole("button", { name: /negative/i }).click();
  await expect(page.locator("html")).toHaveAttribute("data-neg", "");
  await expect(page.getByRole("button", { name: /negative/i })).toHaveAttribute("aria-pressed", "true");
});

test("the plate choice survives a reload and a route change", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("body[data-ready]");
  await page.getByRole("button", { name: /negative/i }).click();
  await expect(page.locator("html")).toHaveAttribute("data-neg", "");

  await page.reload();
  // Applied in the head, so it is already dark on the very first frame — no light flash.
  await expect(page.locator("html")).toHaveAttribute("data-neg", "");
  await expect(page.getByRole("button", { name: /negative/i })).toHaveAttribute("aria-pressed", "true");

  await page.goto("/#/search?q=saga");
  await expect(page.locator("html")).toHaveAttribute("data-neg", "");

  await page.getByRole("button", { name: /negative/i }).click();
  await page.reload();
  await expect(page.locator("html")).not.toHaveAttribute("data-neg", "");
});

test("no console errors, axe clean", async ({ page }) => {
  const errors = [];
  page.on("pageerror", e => errors.push(e));
  await page.goto("/");
  await page.waitForSelector("body[data-ready]");
  await expect(page.locator("#dressno")).not.toBeEmpty();
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
  expect(errors).toEqual([]);
});
