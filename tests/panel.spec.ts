import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { CoreData } from "../src/data/types";

const nf = (n: number) => n.toLocaleString("en-US");

async function coreData(page: Page) {
  return page.evaluate(() => fetch("d/core.json").then(r => r.json() as Promise<CoreData>));
}

test("the directory accounts for every name in the archive", async ({ page }) => {
  await page.goto("/#/panel");
  await page.waitForSelector(".azrow");
  const core = await coreData(page);

  await expect(page.locator("#dressno")).toHaveText("The Panel");
  await expect(page.locator(".pagehead h1")).toHaveText("Panelists & Guests");

  const regulars = await page.locator(".panelgrid .pblock").count();
  const guests = await page.locator(".azrow").count();
  expect(regulars).toBe(13);
  // The guest list is derived, not written down: roster + guests is everyone, exactly.
  expect(regulars + guests).toBe(core.stats.people);
  await expect(page.locator(".statline")).toContainText(nf(core.stats.people));
});

test("every regular carries a portrait, a tagline and a link to their page", async ({ page }) => {
  await page.goto("/#/panel");
  await page.waitForSelector(".panelgrid .pblock");
  const blocks = page.locator(".panelgrid .pblock");
  for (let i = 0; i < await blocks.count(); i++) {
    const b = blocks.nth(i);
    expect(await b.getAttribute("href")).toMatch(/^#\/who\/.+/);
    await expect(b.locator("img")).toHaveAttribute("src", /avatars\/.+\.webp$/);
    await expect(b.locator(".ptag")).not.toBeEmpty();
    await expect(b.locator(".st")).toContainText("%");
  }
});

test("regulars credited by a short name are folded, and the fold is disclosed on About", async ({ page }) => {
  await page.goto("/#/panel");
  await page.waitForSelector(".azrow");

  /* The disclosure used to be a parenthetical in this page's statline. Mike cut it on
     2026-08-09: it explained a data discrepancy no visitor asked about. The fold still has
     to be disclosed *somewhere*, so the assertion moved to About rather than being dropped —
     silently folding two spellings into one person is the thing that would need admitting. */
  await expect(page.locator("#view .statline")).not.toContainText("short name");

  // None of the folded spellings may sit in the guest list as their own person, and no
  // regular may appear there under any spelling.
  const names = await page.locator(".azrow .nm").allInnerTexts();
  for (const n of ["Danny Martinez", "Daniel Martinez", "Nick", "Nick White", "Paul", "Paul Jaissle", "Kate", "Kate Skocelas"]) {
    expect(names).not.toContain(n);
  }

  // ...and About still owns the admission.
  await page.goto("/#/about");
  await expect(page.locator(".sparse")).toBeVisible();
  await expect(page.locator("#view")).toContainText(/short name/i);
});

test("a folded short name lands on the regular's page, not a guest page", async ({ page }) => {
  for (const [alias, display] of [["Nick", "Nick White"], ["Paul", "Paul Jaissle"], ["Kate", "Kate Skocelas"], ["Danny%20Martinez", "Daniel Martinez"]]) {
    await page.goto(`/#/who/${alias}`);
    await page.waitForSelector(".credit-head h1");
    await expect(page.locator(".credit-head h1")).toHaveText(display ?? "");
    // A guest page has no portrait or tagline; landing on one would mean the fold missed.
    await expect(page.locator(".credit-head .tagline")).toBeVisible();
  }
});

test("guests bucket A-Z and the counts add up", async ({ page }) => {
  await page.goto("/#/panel");
  await page.waitForSelector(".azrow");

  const letters = await page.locator(".azsec > h3").evaluateAll(els =>
    els.map(e => e.firstChild?.textContent?.trim() ?? ""));
  expect(letters).toEqual([...letters].sort());

  const bucketTotal = await page.locator(".azsec > h3 > span").evaluateAll(els =>
    els.reduce((n, e) => n + Number(e.textContent.replace(/,/g, "")), 0));
  expect(bucketTotal).toBe(await page.locator(".azrow").count());
});

test("a guest row opens their credits", async ({ page }) => {
  await page.goto("/#/panel");
  await page.waitForSelector(".azrow");
  const name = await page.locator(".azrow .nm").first().textContent();
  await page.locator(".azrow").first().click();
  await expect(page).toHaveURL(/#\/who\//);
  await expect(page.locator(".credit-head h1")).toHaveText(name ?? "");
});

test("the panel grid on home links through to the directory", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector(".panelgrid .pblock");
  await page.locator('#view a[href="#/panel"]').first().click();
  await expect(page.locator(".pagehead h1")).toHaveText("Panelists & Guests");
});
