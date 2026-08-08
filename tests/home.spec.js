import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// The prototype names these .cover-hero / .panels > .panel — the plan's .hero/.plate
// were approximations, and the prototype's markup is the authority.

test("home shows hero and recent episodes from real data", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".cover-hero .pricebox")).toContainText(/\d+:\d\d/);
  await expect(page.locator(".hero-title")).not.toBeEmpty();
  const panels = page.locator(".panels .panel");
  await expect(panels).toHaveCount(8);
  await panels.first().locator("a.ts").click();
  await expect(page).toHaveURL(/#\/ep\//);
});

test("hero links to a real episode and counts are honest", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".hero-side .micro")).toContainText(/EP\. \d+ · \w{3} \d+, \d{4} · \d+ comics? indexed/);
  await expect(page.locator(".sfx")).toContainText(/[\d,]+ comics!/);
  await page.locator(".big-play").click();
  await expect(page).toHaveURL(/#\/ep\//);
});

test("first paint fetches core.json only", async ({ page }) => {
  const data = [];
  page.on("request", r => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/d/")) data.push(u.pathname);
  });
  await page.goto("/");
  await expect(page.locator(".panels .panel")).toHaveCount(8);
  expect(data).toEqual(["/d/core.json"]);
});

test("home is axe clean with no console errors", async ({ page }) => {
  const errors = [];
  page.on("pageerror", e => errors.push(e));
  await page.goto("/");
  await expect(page.locator(".cover-hero")).toBeVisible();
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
  expect(errors).toEqual([]);
});
