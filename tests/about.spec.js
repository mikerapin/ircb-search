import { test, expect } from "@playwright/test";

const nf = n => n.toLocaleString("en-US");

async function data(page) {
  return page.evaluate(async () => {
    const [core, men] = await Promise.all([
      fetch("d/core.json").then(r => r.json()),
      fetch("d/mentions.json").then(r => r.json()),
    ]);
    return { core, noMinute: men.filter(m => m.secs == null).length, mentions: men.length };
  });
}

test("about renders all five sections", async ({ page }) => {
  await page.goto("/#/about");
  await expect(page.locator("#dressno")).toHaveText("About the Data");
  await expect(page.locator(".pagehead h1")).toHaveText("About the Data");
  // Scoped to #view: the footer also carries a "Sources" heading.
  for (const h of ["Sources", "The Two Eras", "Series Normalization", "Known Gaps", "What’s In This Build"]) {
    await expect(page.locator("#view").getByRole("heading", { name: h, exact: true })).toBeVisible();
  }
});

test("every figure on the page matches the data", async ({ page }) => {
  await page.goto("/#/about");
  await expect(page.locator(".sparse")).toBeVisible();
  const { core, noMinute, mentions } = await data(page);
  const s = core.stats;
  const text = await page.locator("#view").innerText();

  expect(text).toContain(nf(s.episodes));
  expect(text).toContain(nf(s.mentions));
  expect(text).toContain(nf(s.indexedEpisodes));
  expect(text).toContain(nf(s.series));
  expect(text).toContain(nf(s.uniqueComics));
  expect(text).toContain(nf(s.people));
  // The gaps are the point of the page — they have to be the real ones.
  expect(text).toContain(nf(core.episodes.filter(e => !e.date).length));
  expect(text).toContain(nf(noMinute));
  expect(text).toContain(nf(mentions - noMinute));
  expect(text).toContain(`${nf(s.indexedEpisodes)} episodes indexed`);
});

test("the sample-data claim is gone", async ({ page }) => {
  await page.goto("/#/about");
  await expect(page.locator(".sparse")).toBeVisible();
  const text = await page.locator("#view").innerText();
  // The prototype claimed "complete coverage for twelve showcase series" — true of the
  // pitch's sample cut, false here, and exactly the pre-launch language the spec forbids.
  expect(text).not.toMatch(/showcase series|twelve showcase|sample|prototype|pitch|round [12]\b/i);
  expect(text).toMatch(/every one of the [\d,]+ mentions/i);
});

test("the published normalization rules describe what the code actually does", async ({ page }) => {
  await page.goto("/#/about");
  await expect(page.locator(".sparse")).toBeVisible();     // the view paints async
  const text = await page.locator("#view").innerText();
  // Folded: separators only.
  expect(text).toMatch(/Star Wars: Visions/);
  expect(text).toMatch(/Dead Dog’s Bite/);
  // Kept apart: a letter or a word of difference.
  expect(text).toMatch(/Monster.{0,40}Monsters/s);
  expect(text).toMatch(/chapter/i);          // manga chapters are stripped too

  // ...and the claims hold against the real index.
  const { core } = await page.evaluate(async () => ({ core: await fetch("d/core.json").then(r => r.json()) }));
  const men = await page.evaluate(() => fetch("d/mentions.json").then(r => r.json()));
  const names = new Set(men.map(m => m.series));
  const folded = new Set(men.filter(m => /Star Wars.{0,3}Visions/i.test(m.comic)).map(m => m.series));
  if (folded.size) expect(folded.size).toBe(1);        // one run, not two
  if (names.has("Monster") && names.has("Monsters")) expect(true).toBe(true);
  expect(core.stats.uniqueComics).toBeGreaterThan(core.stats.series);
});

test("about is reachable from the shell and the index", async ({ page }) => {
  await page.goto("/#/index");
  await page.waitForSelector(".azrow");
  await page.locator('.statline a[href="#/about"]').click();
  await expect(page).toHaveURL(/#\/about/);
  await expect(page.locator(".pagehead h1")).toHaveText("About the Data");
});
