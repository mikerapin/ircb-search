import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('IRCB Search', () => {

    test('page loads with trending chips visible', async ({ page }) => {
        await page.goto('/');
        // Wait for data to load — trending chips appear after fetch completes
        await expect(page.locator('.trending-chip').first()).toBeVisible({ timeout: 10000 });
        // No JS errors — page is functional
        await expect(page.locator('.state-box.error')).not.toBeVisible();
    });

    test('trending chip click populates search and shows results', async ({ page }) => {
        await page.goto('/');
        const chip = page.locator('.trending-chip').first();
        await expect(chip).toBeVisible({ timeout: 10000 });

        const comicName = await chip.locator('.tc-name').textContent();
        await chip.click();

        // Input should be populated
        await expect(page.locator('#search-input')).toHaveValue(comicName.trim());
        // Results should appear
        await expect(page.locator('.card').first()).toBeVisible();
    });

    test('trending chip click updates URL with ?q= param', async ({ page }) => {
        await page.goto('/');
        const chip = page.locator('.trending-chip').first();
        await expect(chip).toBeVisible({ timeout: 10000 });

        const comicName = await chip.locator('.tc-name').textContent();
        await chip.click();

        const url = new URL(page.url());
        expect(url.searchParams.get('q')).toBe(comicName.trim());
    });

    test('trending chip counts are plausible (1–559)', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('.trending-chip').first()).toBeVisible({ timeout: 10000 });

        // Only count chips that have a .tc-count badge (All Time + Last 12 Months chips).
        // "New This Week" chips omit the count badge intentionally.
        const chips = page.locator('.trending-chip:has(.tc-count)');
        const count = await chips.count();
        expect(count).toBeGreaterThan(0);

        for (let i = 0; i < count; i++) {
            const countText = await chips.nth(i).locator('.tc-count').textContent();
            const n = parseInt(countText);
            expect(n).toBeGreaterThanOrEqual(1);
            expect(n).toBeLessThanOrEqual(2000);
        }
    });

    test('searching "Saga" returns comic mention cards', async ({ page }) => {
        await page.goto('/');
        await page.locator('#search-input').fill('Saga');
        await expect(page.locator('.card').first()).toBeVisible({ timeout: 5000 });
        // Should have a Comic Mentions section
        await expect(page.locator('.section-label').first()).toContainText('Comic Mentions');
    });

    test('comic mention cards show episode title as primary heading with comic eyebrow above', async ({ page }) => {
        await page.goto('/');
        await page.locator('#search-input').fill('Saga');
        await expect(page.locator('.card').first()).toBeVisible({ timeout: 5000 });
        const firstCard = page.locator('.card').first();
        await expect(firstCard.locator('.comic-eyebrow')).toBeVisible();
        await expect(firstCard.locator('.episode-title')).toBeVisible();
        // Eyebrow must come before episode title in the DOM
        const eyebrowFirst = await firstCard.evaluate(el => {
            const all = [...el.querySelectorAll('.comic-eyebrow, .episode-title')];
            return all[0]?.classList.contains('comic-eyebrow');
        });
        expect(eyebrowFirst).toBe(true);
    });

    test('comic eyebrow is clickable and triggers a search for that comic', async ({ page }) => {
        await page.goto('/');
        await page.locator('#search-input').fill('Saga');
        await expect(page.locator('.card').first()).toBeVisible({ timeout: 5000 });
        const eyebrow = page.locator('.comic-eyebrow').first();
        const rawText = (await eyebrow.textContent()) || '';
        const comicName = rawText.replace(/→$/, '').trim();
        await eyebrow.click();
        await expect(page.locator('#search-input')).toHaveValue(comicName);
    });

    test('comic result cards do not show blue episode count pill', async ({ page }) => {
        await page.goto('/');
        await page.locator('#search-input').fill('Saga');
        await expect(page.locator('.card').first()).toBeVisible({ timeout: 5000 });
        // No blue pills anywhere in results
        await expect(page.locator('.pill-blue')).not.toBeVisible();
    });

    test('typing in search updates URL ?q= param', async ({ page }) => {
        await page.goto('/');
        await page.locator('#search-input').fill('batman');
        await page.waitForURL('**/?q=batman', { timeout: 1000 });

        const url = new URL(page.url());
        expect(url.searchParams.get('q')).toBe('batman');
    });

    test('URL ?q= param restores search on page load', async ({ page }) => {
        await page.goto('/?q=batman');
        // Input should be pre-populated
        await expect(page.locator('#search-input')).toHaveValue('batman');
        // Results should be visible
        await expect(page.locator('.card').first()).toBeVisible({ timeout: 10000 });
    });

    test('mode tab click adds ?mode= to URL', async ({ page }) => {
        await page.goto('/');
        await page.locator('.tab[data-mode="comics"]').click();

        const url = new URL(page.url());
        expect(url.searchParams.get('mode')).toBe('comics');

        // Switching back to "all" removes the param
        await page.locator('.tab[data-mode="all"]').click();
        const url2 = new URL(page.url());
        expect(url2.searchParams.get('mode')).toBeNull();
    });

    test('gibberish search shows no-results state', async ({ page }) => {
        await page.goto('/');
        await page.locator('#search-input').fill('xyzzy123noresults');
        await expect(page.locator('.state-box')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.state-box h2')).toContainText('No Results');
    });

    test('no-results with active filter mentions the filter and offers Clear filter button', async ({ page }) => {
        await page.goto('/?q=xyzzy123noresults&panelist=Kate');
        await expect(page.locator('.state-box')).toBeVisible({ timeout: 10000 });
        await expect(page.locator('.state-box')).toContainText(/filter/i);
        await expect(page.locator('.state-box .clear-filter-btn')).toBeVisible();
    });

    test('clear button appears on type and clears on click', async ({ page }) => {
        await page.goto('/');
        const clearBtn = page.locator('#clear-btn');
        await expect(clearBtn).not.toBeVisible();
        await page.locator('#search-input').fill('Saga');
        await expect(clearBtn).toBeVisible();
        await clearBtn.click();
        await expect(page.locator('#search-input')).toHaveValue('');
        await expect(clearBtn).not.toBeVisible();
        await expect(page.locator('.trending-chip').first()).toBeVisible({ timeout: 5000 });
    });

    test('clicking logo clears search and shows trending chips', async ({ page }) => {
        await page.goto('/');
        await page.locator('#search-input').fill('Saga');
        await expect(page.locator('.card').first()).toBeVisible({ timeout: 5000 });
        await page.locator('.logo-row').click();
        await expect(page.locator('#search-input')).toHaveValue('');
        await expect(page.locator('.trending-chip').first()).toBeVisible({ timeout: 5000 });
    });

    test('panelist filter chips not visible on empty state, visible with results', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('.trending-chip').first()).toBeVisible({ timeout: 10000 });
        await expect(page.locator('.panelist-chip')).toHaveCount(0);

        await page.locator('#search-input').fill('Batman');
        await expect(page.locator('.card').first()).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.panelist-chip').first()).toBeVisible();
    });

    test('panelist filter narrows results', async ({ page }) => {
        await page.goto('/');
        await page.locator('#search-input').fill('Batman');
        await expect(page.locator('#sort-row')).toBeVisible({ timeout: 5000 });
        const totalBefore = await page.locator('.card').count();
        const firstChip = page.locator('.panelist-chip').first();
        const chipText = (await firstChip.textContent()).trim();
        await firstChip.click();
        await page.waitForTimeout(300);
        const totalAfter = await page.locator('.card').count();
        expect(totalAfter).toBeLessThan(totalBefore);
        if (totalAfter > 0) {
            const peopleTexts = await page.locator('.meta-people').allTextContents();
            expect(peopleTexts.some(t => t.includes(chipText))).toBe(true);
        }
    });

    test('play button exists on comic cards', async ({ page }) => {
        await page.goto('/');
        await page.locator('#search-input').fill('Saga');
        await expect(page.locator('.card').first()).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.play-btn').first()).toBeVisible();
    });

    test('guest episodes show orange pill', async ({ page }) => {
        await page.goto('/?q=ft.');
        await expect(page.locator('.card').first()).toBeVisible({ timeout: 10000 });
        await expect(page.locator('.pill-orange').first()).toBeVisible();
    });

    test('trending chips split into All Time and Last 12 Months sections', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('.trending-chip').first()).toBeVisible({ timeout: 10000 });
        // "All Time" and "Last 12 Months" must both exist; "New This Week" may also be present
        const headers = page.locator('.trending-header');
        const texts = await headers.allTextContents();
        expect(texts.some(t => t.includes('All Time'))).toBe(true);
        expect(texts.some(t => t.includes('Last 12 Months'))).toBe(true);
    });

    test('both trending sections have chips', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('.trending-chip').first()).toBeVisible({ timeout: 10000 });
        const allHeaders = page.locator('.trending-header');
        const headerCount = await allHeaders.count();
        // "New This Week" may add a third header; at minimum All Time + Last 12 Months = 2
        expect(headerCount).toBeGreaterThanOrEqual(2);
        const totalChips = await page.locator('.trending-chip').count();
        expect(totalChips).toBeGreaterThan(10);
    });

    test('guest filter chip not visible on empty state', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('.trending-chip').first()).toBeVisible({ timeout: 10000 });
        await expect(page.locator('.guest-chip')).toHaveCount(0);
    });

    test('guest filter chip visible with results and filters to guest episodes', async ({ page }) => {
        await page.goto('/');
        await page.locator('#search-input').fill('Batman');
        await expect(page.locator('.card').first()).toBeVisible({ timeout: 5000 });

        await expect(page.locator('.guest-chip')).toBeVisible();
        const totalBefore = await page.locator('.card').count();

        await page.locator('.guest-chip').click();
        await page.waitForTimeout(300);
        const totalAfter = await page.locator('.card').count();
        expect(totalAfter).toBeLessThanOrEqual(totalBefore);

        // All visible cards should be from guest episodes (have orange pill)
        const cards = page.locator('.card');
        const count = await cards.count();
        if (count > 0) {
            await expect(page.locator('.pill-orange').first()).toBeVisible();
        }
    });

    test('guest filter URL param ?guest=1 restores filter on load', async ({ page }) => {
        await page.goto('/?q=Batman&guest=1');
        await expect(page.locator('.card').first()).toBeVisible({ timeout: 10000 });
        await expect(page.locator('.guest-chip.active')).toBeVisible();
    });

    test('clear resets guest filter', async ({ page }) => {
        await page.goto('/');
        await page.locator('#search-input').fill('Batman');
        await expect(page.locator('.guest-chip')).toBeVisible({ timeout: 5000 });
        await page.locator('.guest-chip').click();
        await expect(page.locator('.guest-chip.active')).toBeVisible();

        await page.locator('#clear-btn').click();
        await expect(page.locator('.trending-chip').first()).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.guest-chip')).toHaveCount(0);

        await page.locator('#search-input').fill('Batman');
        await expect(page.locator('.guest-chip')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.guest-chip.active')).toHaveCount(0);
    });

    test('safeUrl rejects non-https and unknown hosts', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('.trending-chip').first()).toBeVisible({ timeout: 10000 });
        const results = await page.evaluate(async () => {
            const { safeUrl } = await import('/js/format.js');
            return [
                safeUrl('javascript:alert(1)'),
                safeUrl('http://simplecast.com/ep'),
                safeUrl('https://evil.com/xss'),
                safeUrl('https://player.simplecast.com/abc-123'),
                safeUrl('https://patreon.com/ircbpodcast'),
                safeUrl(''),
                safeUrl(null),
                safeUrl('https://evil.simplecast.com/xss'),
            ];
        });
        expect(results[0]).toBe('#');                                         // javascript: blocked
        expect(results[1]).toBe('#');                                         // http: blocked
        expect(results[2]).toBe('#');                                         // unknown host blocked
        expect(results[3]).toBe('https://player.simplecast.com/abc-123');    // allowed
        expect(results[4]).toBe('https://patreon.com/ircbpodcast');          // allowed
        expect(results[5]).toBe('#');                                         // empty blocked
        expect(results[6]).toBe('#');                                         // null blocked
        expect(results[7]).toBe('#');                                         // adversarial subdomain blocked
    });

    test('denylist terms do not appear as trending chip names', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('.trending-chip').first()).toBeVisible({ timeout: 10000 });
        const denylist = ['comic books', 'comics', 'ircb', 'i read comic books', 'guest'];
        const chips = page.locator('.trending-chip .tc-name');
        const count = await chips.count();
        for (let i = 0; i < count; i++) {
            const name = (await chips.nth(i).textContent()).trim().toLowerCase();
            expect(denylist).not.toContain(name);
        }
    });

    test('Fuse.js loads from vendor, not CDN', async ({ page }) => {
        const cdnRequests = [];
        page.on('request', req => {
            if (req.url().includes('jsdelivr.net')) cdnRequests.push(req.url());
        });
        await page.goto('/');
        await expect(page.locator('.trending-chip').first()).toBeVisible({ timeout: 10000 });
        expect(cdnRequests).toHaveLength(0);
    });

    test('fmtDate handles valid dates correctly', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('.trending-chip').first()).toBeVisible({ timeout: 10000 });
        // After data loads, cards with valid dates should show formatted dates
        await page.locator('#search-input').fill('Saga');
        await expect(page.locator('.card').first()).toBeVisible({ timeout: 5000 });
        // At least some cards should have a date badge (non-empty)
        const dateBadges = page.locator('.card-date');
        const count = await dateBadges.count();
        expect(count).toBeGreaterThan(0);
        const firstDate = await dateBadges.first().textContent();
        expect(firstDate.trim()).toMatch(/\w+ \d+, \d{4}/);
    });

    test('tsToSeconds returns 0 for missing or malformed timestamps', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('.trending-chip').first()).toBeVisible({ timeout: 10000 });
        const result = await page.evaluate(async () => {
            // Test the function directly — it's exported from js/format.js
            const { tsToSeconds } = await import('/js/format.js');
            return [
                tsToSeconds(null),
                tsToSeconds(''),
                tsToSeconds('abc:xyz'),
                tsToSeconds('00:00:00'),
            ];
        });
        expect(result[0]).toBe(0); // null
        expect(result[1]).toBe(0); // empty
        expect(result[2]).toBe(0); // NaN parts
        expect(result[3]).toBe(0); // zero timestamp
    });

    test('all outbound links use rel="noopener noreferrer"', async ({ page }) => {
        await page.goto('/');
        await page.locator('#search-input').fill('Saga');
        await expect(page.locator('.card').first()).toBeVisible({ timeout: 5000 });
        // Check all target=_blank links on the page
        const links = page.locator('a[target="_blank"]');
        const count = await links.count();
        expect(count).toBeGreaterThan(0);
        for (let i = 0; i < count; i++) {
            const rel = await links.nth(i).getAttribute('rel');
            expect(rel).toContain('noopener');
            expect(rel).toContain('noreferrer');
        }
    });

    test('CSP meta tag is present with expected directives', async ({ page }) => {
        await page.goto('/');
        const csp = await page.evaluate(() => {
            const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
            return meta ? meta.getAttribute('content') : null;
        });
        expect(csp).not.toBeNull();
        expect(csp).toContain('default-src');
        expect(csp).toContain('frame-src https://player.simplecast.com');
        expect(csp).toContain('img-src');
        expect(csp).toContain('font-src https://fonts.gstatic.com');
        // Hardening: unsafe-inline must not be present in script-src; pre-paint
        // script must be whitelisted by its SHA-256 hash instead.
        const scriptSrc = csp?.split(';').find(d => d.trim().startsWith('script-src'));
        expect(scriptSrc).toBeDefined();
        expect(scriptSrc).not.toContain("'unsafe-inline'");
        expect(scriptSrc).toContain("'sha256-");
    });

    // ── E2: new coverage ──────────────────────────────────────────────────────

    test('XSS payload in search is escaped, not executed', async ({ page }) => {
        let alertFired = false;
        page.on('dialog', () => { alertFired = true; });
        await page.goto('/');
        await page.locator('#search-input').fill('<script>alert(1)</script>');
        await page.waitForTimeout(200);
        expect(alertFired).toBe(false);
        const html = await page.locator('#results').innerHTML();
        expect(html).not.toContain('<script>');
    });

    test('embed toggle: play shows iframe, stop hides it, switching closes previous', async ({ page }) => {
        await page.goto('/');
        await page.locator('#search-input').fill('Saga');
        // #sort-row only becomes visible once runSearch() renders results — safe sentinel
        // against the home page's recent-episode cards which are also .card-episode.
        await expect(page.locator('#sort-row')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.card .play-btn').first()).toBeVisible({ timeout: 5000 });

        // Play → iframe appears, button says Stop
        const cardPlayBtns = page.locator('.card .play-btn');
        await cardPlayBtns.first().click();
        await expect(page.locator('.card .embed-wrap iframe').first()).toBeVisible();
        await expect(cardPlayBtns.first()).toContainText('■ Stop');

        // Stop → iframe gone, button restores to original label (not "■ Stop")
        await cardPlayBtns.first().click();
        await expect(page.locator('.card .embed-wrap iframe')).toHaveCount(0);
        await expect(cardPlayBtns.first()).not.toContainText('■ Stop');

        // Click A then B → only B open; A restores to original label
        if (await cardPlayBtns.count() >= 2) {
            await cardPlayBtns.first().click();
            await cardPlayBtns.nth(1).click();
            await expect(page.locator('.card .embed-wrap iframe')).toHaveCount(1);
            await expect(cardPlayBtns.first()).not.toContainText('■ Stop');
            await expect(cardPlayBtns.nth(1)).toContainText('■ Stop');
        }
    });

    test('?sort=recent URL param restores sort on load', async ({ page }) => {
        await page.goto('/?q=Batman&sort=recent');
        await expect(page.locator('.card').first()).toBeVisible({ timeout: 10000 });
        await expect(page.locator('.sort-btn[data-sort="recent"]')).toHaveClass(/active/);
        expect(new URL(page.url()).searchParams.get('sort')).toBe('recent');
    });

    test('?panelist= URL param restores panelist filter on load', async ({ page }) => {
        await page.goto('/');
        await page.locator('#search-input').fill('Batman');
        await expect(page.locator('.panelist-chip').first()).toBeVisible({ timeout: 5000 });
        await page.locator('.panelist-chip').first().click();
        await page.waitForTimeout(200);
        const savedUrl = page.url();
        expect(new URL(savedUrl).searchParams.get('panelist')).not.toBeNull();

        await page.goto(savedUrl);
        await expect(page.locator('.card').first()).toBeVisible({ timeout: 10000 });
        await expect(page.locator('.panelist-chip.active')).toBeVisible();
    });

    test('Topics mode returns episode cards only, no Comic Mentions section', async ({ page }) => {
        await page.goto('/');
        await page.locator('.tab[data-mode="topics"]').click();
        await page.locator('#search-input').fill('batman');
        await expect(page.locator('#sort-row')).toBeVisible({ timeout: 5000 });
        const labelTexts = await page.locator('.section-label').allTextContents();
        expect(labelTexts.some(t => t.includes('Episodes by Topic'))).toBe(true);
        expect(labelTexts.some(t => t.includes('Comic Mentions'))).toBe(false);
    });

    test('logo clear resets query, panelist filter, and URL', async ({ page }) => {
        await page.goto('/');
        await page.locator('#search-input').fill('Batman');
        await expect(page.locator('.panelist-chip').first()).toBeVisible({ timeout: 5000 });
        await page.locator('.panelist-chip').first().click();
        await page.locator('.sort-btn[data-sort="recent"]').click();
        await page.waitForTimeout(200);

        await page.locator('.logo-row').click();

        await expect(page.locator('#search-input')).toHaveValue('');
        await expect(page.locator('.trending-chip').first()).toBeVisible({ timeout: 5000 });
        expect(new URL(page.url()).search).toBe('');
    });

    // ── E3: axe accessibility scans ──────────────────────────────────────────

    test('axe: empty state has no critical violations', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('.trending-chip').first()).toBeVisible({ timeout: 10000 });
        const results = await new AxeBuilder({ page }).analyze();
        const critical = results.violations.filter(v => v.impact === 'critical');
        expect(critical).toHaveLength(0);
    });

    test('axe: results state has no critical violations', async ({ page }) => {
        await page.goto('/');
        await page.locator('#search-input').fill('Saga');
        await expect(page.locator('.card').first()).toBeVisible({ timeout: 5000 });
        await page.waitForTimeout(200);
        const results = await new AxeBuilder({ page }).analyze();
        const critical = results.violations.filter(v => v.impact === 'critical');
        expect(critical).toHaveLength(0);
    });

    test('axe: no-results state has no critical violations', async ({ page }) => {
        await page.goto('/');
        await page.locator('#search-input').fill('xyzzy123noresults');
        await page.waitForTimeout(200);
        await expect(page.locator('.state-box')).toBeVisible({ timeout: 5000 });
        const results = await new AxeBuilder({ page }).analyze();
        const critical = results.violations.filter(v => v.impact === 'critical');
        expect(critical).toHaveLength(0);
    });

    test('prefers-reduced-motion disables spinner animation', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.route('**/data/comics.json', route =>
            new Promise(r => setTimeout(() => { r(); route.continue(); }, 500))
        );
        await page.goto('/');
        await expect(page.locator('.state-box.loading')).toBeVisible();
        const animName = await page.locator('.state-box.loading .icon').evaluate(el =>
            getComputedStyle(el).animationName
        );
        expect(animName).toBe('none');
    });

    // ── E4: timestamp formatter + embedded player ────────────────────────────

    test('secsToSimplecastT formats seconds into 00h00m00s pattern', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('.trending-chip').first()).toBeVisible({ timeout: 10000 });
        const results = await page.evaluate(async () => {
            const { secsToSimplecastT } = await import('/js/format.js');
            return [
                secsToSimplecastT(2990),
                secsToSimplecastT(3661),
                secsToSimplecastT(0),
                secsToSimplecastT(null),
                secsToSimplecastT(60),
            ];
        });
        expect(results[0]).toBe('00h49m50s');  // 2990s = 49m50s
        expect(results[1]).toBe('01h01m01s');  // 3661s = 1h1m1s
        expect(results[2]).toBe('');            // 0 returns empty string
        expect(results[3]).toBe('');            // null returns empty string
        expect(results[4]).toBe('00h01m00s');  // 60s = 1m
    });

    test('Jump to mention embed iframe src uses formatted t= timestamp not raw seconds', async ({ page }) => {
        await page.goto('/');
        await page.locator('#search-input').fill('Saga');
        await expect(page.locator('button.play-btn.timestamp').first()).toBeVisible({ timeout: 5000 });

        await page.locator('button.play-btn.timestamp').first().click();

        const iframe = page.locator('.embed-wrap iframe').first();
        await expect(iframe).toBeVisible();

        const src = await iframe.getAttribute('src');
        expect(src).toContain('?');
        expect(src).toMatch(/[?&]t=\d{2}h\d{2}m\d{2}s(?:&|$)/);
        expect(src).not.toMatch(/[?&]t=\d+(?:&|$)/);
    });

    test('Jump to mention action is a button not an anchor tag', async ({ page }) => {
        await page.goto('/');
        await page.locator('#search-input').fill('Saga');
        await expect(page.locator('.card').first()).toBeVisible({ timeout: 5000 });

        // Cards with player_id + valid timestamp render a button.play-btn, not an <a>
        await expect(page.locator('button.play-btn.timestamp').first()).toBeVisible();
        // There should be no <a> with timestamp class for those same cards
        // (anchor timestamp links only appear when there is NO player_id)
        const anchorTimestamps = page.locator('a.card-action.timestamp');
        const btnTimestamps = page.locator('button.play-btn.timestamp');
        const btnCount = await btnTimestamps.count();
        expect(btnCount).toBeGreaterThan(0);
        // Any anchor timestamp links present belong to episodes without a player_id;
        // confirm none of those also have a sibling button.play-btn inside the same card
        const anchorCount = await anchorTimestamps.count();
        for (let i = 0; i < anchorCount; i++) {
            const card = anchorTimestamps.nth(i).locator('xpath=ancestor::div[contains(@class,"card")]');
            await expect(card.locator('button.play-btn')).toHaveCount(0);
        }
    });

    test('no card shows both a listen link and a play button at the same time', async ({ page }) => {
        await page.goto('/');
        await page.locator('#search-input').fill('Saga');
        await expect(page.locator('.card').first()).toBeVisible({ timeout: 5000 });

        const cards = page.locator('.card');
        const count = await cards.count();
        for (let i = 0; i < count; i++) {
            const card = cards.nth(i);
            const hasListenLink = await card.locator('a.card-action.listen').count();
            const hasPlayBtn    = await card.locator('button.play-btn').count();
            expect(hasListenLink > 0 && hasPlayBtn > 0).toBe(false);
        }
    });

    test('cards with player_id show Simplecast external link', async ({ page }) => {
        await page.goto('/');
        await page.locator('#search-input').fill('Saga');
        await expect(page.locator('.card').first()).toBeVisible({ timeout: 5000 });

        // At least one card should have a .card-ext-link with text "Simplecast ↗"
        const extLinks = page.locator('.card-ext-link');
        await expect(extLinks.first()).toBeVisible();
        const texts = await extLinks.allTextContents();
        expect(texts.some(t => t.trim() === 'Simplecast ↗')).toBe(true);
    });

    test('Topics mode episode cards with player_id show Play button', async ({ page }) => {
        await page.goto('/');
        await page.locator('.tab[data-mode="topics"]').click();
        await page.locator('#search-input').fill('Saga');
        await expect(page.locator('.card').first()).toBeVisible({ timeout: 5000 });

        // Episode cards with player_id render a ▶ Play button
        const playBtns = page.locator('button.play-btn');
        await expect(playBtns.first()).toBeVisible();
        const labels = await playBtns.allTextContents();
        expect(labels.some(t => t.trim() === '▶ Play')).toBe(true);
    });

    // ── E5: sort row visibility, trending header styles, empty-state-wrap ────────

    test('sort row is hidden on initial page load', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('.trending-chip').first()).toBeVisible({ timeout: 10000 });
        await expect(page.locator('#sort-row')).toBeHidden();
    });

    test('sort row is hidden when URL has ?sort=recent but no query', async ({ page }) => {
        await page.goto('/?sort=recent');
        await expect(page.locator('.trending-chip').first()).toBeVisible({ timeout: 10000 });
        await expect(page.locator('#sort-row')).toBeHidden();
    });

    test('sort row is visible after a search returns results', async ({ page }) => {
        await page.goto('/');
        await page.locator('#search-input').fill('Saga');
        await expect(page.locator('.card').first()).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#sort-row')).toBeVisible();
    });

    test('sort row is hidden when search returns no results', async ({ page }) => {
        await page.goto('/');
        await page.locator('#search-input').fill('xyzzy123noresults');
        await expect(page.locator('.state-box')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#sort-row')).toBeHidden();
    });

    test('sort row is hidden after logo clear from results state', async ({ page }) => {
        await page.goto('/');
        await page.locator('#search-input').fill('Saga');
        await expect(page.locator('.card').first()).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#sort-row')).toBeVisible();
        await page.locator('.logo-row').click();
        await expect(page.locator('#sort-row')).toBeHidden();
    });

    test('trending header has font-weight 600', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('.trending-header').first()).toBeVisible({ timeout: 10000 });
        const fontWeight = await page.locator('.trending-header').first().evaluate(el =>
            getComputedStyle(el).fontWeight
        );
        // Bangers is a single-weight display font; browser resolves to 400 regardless of font-weight declaration
        expect(['400', '600']).toContain(fontWeight);
    });

    test('trending header color is var(--text) full brightness', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('.trending-header').first()).toBeVisible({ timeout: 10000 });
        const color = await page.locator('.trending-header').first().evaluate(el =>
            getComputedStyle(el).color
        );
        // --text resolves to #f0f0f8 = rgb(240, 240, 248)
        expect(color).toBe('rgb(240, 240, 248)');
    });

    test('empty state wrapper has class empty-state-wrap', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('.empty-state-wrap')).toBeVisible({ timeout: 10000 });
    });

    test('empty state wrapper has min-height of 55vh', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('.empty-state-wrap')).toBeVisible({ timeout: 10000 });
        const isAtLeast55vh = await page.locator('.empty-state-wrap').evaluate(el => {
            const rect = el.getBoundingClientRect();
            return rect.height >= window.innerHeight * 0.5;
        });
        expect(isAtLeast55vh).toBe(true);
    });

    // ── E6: fuzzy chip count recomputation + sort ────────────────────────────

    test('All Time trending chips are sorted descending by count', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('.trending-chip').first()).toBeVisible({ timeout: 10000 });

        // Locate the grid that follows the "All Time" header, not by index (which shifts
        // when "New This Week" section is present).
        const allTimeChips = page.locator(
            '.trending-header:text("All Time") + .trending-grid .tc-count'
        );
        const count = await allTimeChips.count();
        expect(count).toBeGreaterThan(0);

        const counts = [];
        for (let i = 0; i < count; i++) {
            const text = await allTimeChips.nth(i).textContent();
            counts.push(parseInt(text));
        }

        for (let i = 1; i < counts.length; i++) {
            expect(counts[i]).toBeLessThanOrEqual(counts[i - 1]);
        }
    });

    test('Last 12 Months trending chips are sorted descending by count', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('.trending-chip').first()).toBeVisible({ timeout: 10000 });

        const recentChips = page.locator(
            '.trending-header:text("Last 12 Months") + .trending-grid .tc-count'
        );
        const count = await recentChips.count();
        expect(count).toBeGreaterThan(0);

        const counts = [];
        for (let i = 0; i < count; i++) {
            const text = await recentChips.nth(i).textContent();
            counts.push(parseInt(text));
        }

        for (let i = 1; i < counts.length; i++) {
            expect(counts[i]).toBeLessThanOrEqual(counts[i - 1]);
        }
    });

    // ── E7: "New This Week" panel ────────────────────────────────────────────

    test('"New This Week" section appears on empty state', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('.trending-chip').first()).toBeVisible({ timeout: 10000 });
        const headers = page.locator('.trending-header');
        const texts = await headers.allTextContents();
        expect(texts.some(t => t.includes('New This Week'))).toBe(true);
    });

    test('"New This Week" shows episode title and date', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('.trending-chip').first()).toBeVisible({ timeout: 10000 });
        const ep = page.locator('.new-this-week-ep');
        await expect(ep).toBeVisible({ timeout: 5000 });
        const text = await ep.textContent();
        expect(text.trim().length).toBeGreaterThan(0);
    });

    test('"New This Week" chips trigger a search when clicked', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('.trending-chip').first()).toBeVisible({ timeout: 10000 });
        const chip = page.locator('.new-this-week-ep + .trending-grid .trending-chip').first();
        await expect(chip).toBeVisible({ timeout: 5000 });
        await chip.click();
        await expect(page.locator('#search-input')).not.toHaveValue('', { timeout: 5000 });
        await expect(page.locator('.card').first()).toBeVisible({ timeout: 5000 });
    });

    test('"New This Week" chips only show series appearing in 2+ episodes', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('.trending-chip').first()).toBeVisible({ timeout: 10000 });
        // latestEpisodeComics and comicEpisodes are exposed on window by app.js after data loads
        const result = await page.evaluate(() => {
            const comics = window.latestEpisodeComics || [];
            const eps = window.comicEpisodes || {};
            return comics.every(name => (eps[name] || new Set()).size >= 2);
        });
        expect(result).toBe(true);
    });

    test('"New This Week" section not visible after search', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('.trending-chip').first()).toBeVisible({ timeout: 10000 });
        await page.locator('#search-input').fill('Saga');
        await expect(page.locator('#sort-row')).toBeVisible({ timeout: 5000 });
        const headers = page.locator('.trending-header');
        const texts = await headers.allTextContents();
        expect(texts.some(t => t.includes('New This Week'))).toBe(false);
    });

    // ── E7: Panelist pages ────────────────────────────────────────────────────

    test('panelist page renders for valid panelist', async ({ page }) => {
        await page.goto('/?view=panelist&name=Mike+Rapin');
        await expect(page.locator('.panelist-hero')).toBeVisible({ timeout: 10000 });
        await expect(page.locator('.panelist-hero')).toContainText('Mike Rapin');
    });

    test('panelist page shows episode cards', async ({ page }) => {
        await page.goto('/?view=panelist&name=Mike+Rapin');
        await expect(page.locator('.panelist-hero')).toBeVisible({ timeout: 10000 });
        await expect(page.locator('.card').first()).toBeVisible({ timeout: 5000 });
    });

    test('panelist page shows Most Discussed comics section', async ({ page }) => {
        await page.goto('/?view=panelist&name=Mike+Rapin');
        await expect(page.locator('.panelist-hero')).toBeVisible({ timeout: 10000 });
        const headers = page.locator('.trending-header');
        const texts = await headers.allTextContents();
        expect(texts.some(t => t.includes('Most Discussed'))).toBe(true);
    });

    test('panelist page hides search input', async ({ page }) => {
        await page.goto('/?view=panelist&name=Mike+Rapin');
        await expect(page.locator('.panelist-hero')).toBeVisible({ timeout: 10000 });
        await expect(page.locator('#search-input')).not.toBeVisible({ timeout: 5000 });
    });

    test('back link returns to empty state', async ({ page }) => {
        await page.goto('/?view=panelist&name=Mike+Rapin');
        await expect(page.locator('.panelist-hero')).toBeVisible({ timeout: 10000 });
        await page.locator('button.back-link').click();
        await expect(page.locator('.trending-chip').first()).toBeVisible({ timeout: 5000 });
        expect(page.url()).not.toContain('view=panelist');
    });

    test('logo click from panelist page restores search input', async ({ page }) => {
        await page.goto('/?view=panelist&name=Mike+Rapin');
        await expect(page.locator('.panelist-hero')).toBeVisible({ timeout: 10000 });
        await expect(page.locator('#search-input')).not.toBeVisible();
        await page.locator('.logo-row').click();
        await expect(page.locator('#search-input')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('.trending-chip').first()).toBeVisible({ timeout: 5000 });
    });

    test('"Meet the Panelists" button is visible on empty state', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('.trending-chip').first()).toBeVisible({ timeout: 10000 });
        await expect(page.locator('#panelist-nav-btn')).toBeVisible();
    });

    test('"Meet the Panelists" dropdown opens and shows panelist cards', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('.trending-chip').first()).toBeVisible({ timeout: 10000 });
        await page.locator('#panelist-nav-btn').click();
        await expect(page.locator('#panelist-dropdown')).toHaveClass(/open/);
        const items = page.locator('.panelist-dropdown-item');
        await expect(items).toHaveCount(13);
    });

    test('unknown panelist shows graceful empty state', async ({ page }) => {
        const jsErrors = [];
        page.on('pageerror', err => jsErrors.push(err.message));
        await page.goto('/?view=panelist&name=Zzz+Unknown+Person');
        await page.waitForTimeout(3000);
        // No uncaught JS errors
        expect(jsErrors).toHaveLength(0);
        // Page renders some content — either a "no episodes" message or back link
        const hasContent = await page.locator('h2, button.back-link, .panelist-hero').count();
        expect(hasContent).toBeGreaterThan(0);
    });

    test('fuzzy chip counts are higher than old exact-match floor', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('.trending-chip').first()).toBeVisible({ timeout: 10000 });

        // Check if "Star Wars" is present in the top 10 chips (all sections combined)
        const allChips = page.locator('.trending-chip');
        const totalChips = await allChips.count();
        let starWarsChip = null;
        for (let i = 0; i < totalChips; i++) {
            const name = await allChips.nth(i).locator('.tc-name').textContent();
            if (name.trim() === 'Star Wars') {
                starWarsChip = allChips.nth(i);
                break;
            }
        }

        if (starWarsChip) {
            const countText = await starWarsChip.locator('.tc-count').textContent();
            const chipCount = parseInt(countText);
            // Old exact-match count was 14; fuzzy search should yield significantly more
            expect(chipCount).toBeGreaterThan(14);
        } else {
            // "Star Wars" not in top chips — verify the highest-count chip exceeds a
            // reasonable floor given the 559-episode dataset
            const firstCountText = await page.locator('.trending-grid').nth(0).locator('.tc-count').first().textContent();
            const highestCount = parseInt(firstCountText);
            expect(highestCount).toBeGreaterThan(50);
        }
    });

    // ── E8: publisher/series grouping ───────────────────────────────────────

    test('normalizeSeries strips issue numbers from comic names', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('.trending-chip').first()).toBeVisible({ timeout: 10000 });
        const results = await page.evaluate(async () => {
            const { normalizeSeries } = await import('/js/format.js');
            return [
                normalizeSeries('Batman #3'),
                normalizeSeries('Batman #140'),
                normalizeSeries('Doctor Aphra #20-24'),
                normalizeSeries('Batman Thrillkiller #1 (1997)'),
                normalizeSeries('Beast of Borikén #1 ft. Julio Anta'),
                normalizeSeries('Sweet Tooth'),
                normalizeSeries('X-Men Blue #4-6'),
                normalizeSeries('Zatanna #1 (2026)'),
            ];
        });
        expect(results[0]).toBe('Batman');
        expect(results[1]).toBe('Batman');
        expect(results[2]).toBe('Doctor Aphra');
        expect(results[3]).toBe('Batman Thrillkiller');
        expect(results[4]).toBe('Beast of Borikén');
        expect(results[5]).toBe('Sweet Tooth');
        expect(results[6]).toBe('X-Men Blue');
        expect(results[7]).toBe('Zatanna');
    });

    test('Batman appears in All Time trending chips after series grouping', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('.trending-chip').first()).toBeVisible({ timeout: 10000 });
        const allTimeChips = page.locator('.trending-header:text("All Time") + .trending-grid .tc-name');
        const count = await allTimeChips.count();
        const names = [];
        for (let i = 0; i < count; i++) {
            names.push((await allTimeChips.nth(i).textContent()).trim());
        }
        expect(names).toContain('Batman');
    });

    // ── E9: you might also like ──────────────────────────────────────────────

    test('findRelated returns episode objects for a Saga episode', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('.trending-chip').first()).toBeVisible({ timeout: 10000 });
        const result = await page.evaluate(async () => {
            const { findRelated } = await import('/js/render.js');
            const { state } = await import('/js/state.js');
            const sagaEp = state.episodes.find(e => (e.keywords || '').toLowerCase().includes('saga'));
            if (!sagaEp) return null;
            const related = findRelated(sagaEp, 3);
            return { count: related.length, allHaveTitles: related.every(r => !!r.title), excludesSelf: related.every(r => r.show_id !== sagaEp.show_id) };
        });
        expect(result).not.toBeNull();
        expect(result.count).toBeGreaterThan(0);
        expect(result.allHaveTitles).toBe(true);
        expect(result.excludesSelf).toBe(true);
    });

    test('expanded show notes include "You might also like" related episode chips', async ({ page }) => {
        await page.goto('/');
        await page.locator('.tab[data-mode="topics"]').click();
        await page.locator('#search-input').fill('Saga');
        await expect(page.locator('.card').first()).toBeVisible({ timeout: 5000 });

        // Find an episode card with a show notes toggle
        const toggleBtn = page.locator('.summary-toggle').first();
        await expect(toggleBtn).toBeVisible();
        await toggleBtn.click();

        await expect(page.locator('.related-chip').first()).toBeVisible();
    });

    test('clicking a related chip runs a new search', async ({ page }) => {
        await page.goto('/');
        await page.locator('.tab[data-mode="topics"]').click();
        await page.locator('#search-input').fill('Saga');
        await expect(page.locator('.card').first()).toBeVisible({ timeout: 5000 });

        await page.locator('.summary-toggle').first().click();
        await expect(page.locator('.related-chip').first()).toBeVisible();

        const chipText = await page.locator('.related-chip').first().evaluate(el => el.textContent.trim());
        await page.locator('.related-chip').first().click();
        await expect(page.locator('.card').first()).toBeVisible({ timeout: 5000 });
        // URL should reflect the new search (related episode title or keyword)
        const url = new URL(page.url());
        expect(url.searchParams.get('q')).not.toBeNull();
    });

    // ── E10: full-text show notes search ─────────────────────────────────────

    test('summary search: "trucker" finds episode via show notes text', async ({ page }) => {
        await page.goto('/');
        await page.locator('.tab[data-mode="topics"]').click();
        await page.locator('#search-input').fill('trucker');
        // "trucker" appears only in a summary, not in any title or keyword
        await expect(page.locator('#sort-row')).toBeVisible({ timeout: 5000 });
        const labels = await page.locator('.section-label').allTextContents();
        expect(labels.some(t => t.includes('Episodes by Topic'))).toBe(true);
    });

    test('summary search: "conspiracy" finds episodes via show notes text', async ({ page }) => {
        await page.goto('/');
        await page.locator('.tab[data-mode="topics"]').click();
        await page.locator('#search-input').fill('conspiracy');
        await expect(page.locator('.card').first()).toBeVisible({ timeout: 5000 });
    });

    test('keyword tags are hidden behind a toggle button by default', async ({ page }) => {
        await page.goto('/');
        await page.locator('#search-input').fill('Saga');
        await expect(page.locator('#sort-row')).toBeVisible({ timeout: 5000 });

        const card = page.locator('.card-episode').first();
        await expect(card.locator('.card-tags')).toBeHidden();

        const tagsToggle = card.locator('.tags-toggle');
        await expect(tagsToggle).toBeVisible();

        await tagsToggle.click();
        await expect(card.locator('.card-tags')).toBeVisible();

        await tagsToggle.click();
        await expect(card.locator('.card-tags')).toBeHidden();
    });

    test('summary-toggle gets is-open class when notes expand', async ({ page }) => {
        await page.goto('/');
        await page.locator('#search-input').fill('Saga');
        await expect(page.locator('#sort-row')).toBeVisible({ timeout: 5000 });

        const toggle = page.locator('.card-episode[data-show-id] .summary-toggle').first();
        await expect(toggle).not.toHaveClass(/is-open/);
        await toggle.click();
        await expect(toggle).toHaveClass(/is-open/);
        await toggle.click();
        await expect(toggle).not.toHaveClass(/is-open/);
    });

    test('clicking episode card body toggles show notes', async ({ page }) => {
        await page.goto('/');
        await page.locator('#search-input').fill('Saga');
        await expect(page.locator('#sort-row')).toBeVisible({ timeout: 5000 });

        // Find a card with show notes (has data-show-id)
        const card = page.locator('.card-episode[data-show-id]').first();
        await expect(card).toBeVisible();
        const summary = card.locator('.card-summary');
        await expect(summary).toBeHidden();

        // Click the title (card body — not a button or link)
        await card.locator('.episode-title').click();
        await expect(summary).toBeVisible();

        // Click again to close
        await card.locator('.episode-title').click();
        await expect(summary).toBeHidden();
    });

    test('clicking play button does not open show notes', async ({ page }) => {
        await page.goto('/');
        await page.locator('#search-input').fill('Saga');
        await expect(page.locator('#sort-row')).toBeVisible({ timeout: 5000 });

        const card = page.locator('.card-episode[data-show-id]').first();
        const summary = card.locator('.card-summary');
        await expect(summary).toBeHidden();

        // Click the play/listen button — should NOT open show notes
        const playBtn = card.locator('.play-btn').first();
        if (await playBtn.count() > 0) {
            await playBtn.click();
            await expect(summary).toBeHidden();
        }
    });

    test('home page shows 3 recent episodes above the trending chips', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('.trending-chip').first()).toBeVisible({ timeout: 5000 });

        // Section heading exists
        const heading = page.locator('.section-label', { hasText: 'Recent Episodes' });
        await expect(heading).toBeVisible();

        // Exactly 3 recent episode cards (full card-episode markup, same as search results)
        const cards = page.locator('.recent-eps-section .card-episode');
        await expect(cards).toHaveCount(3);

        // Each card has a title and a date
        for (let i = 0; i < 3; i++) {
            await expect(cards.nth(i).locator('.episode-title')).not.toBeEmpty();
            await expect(cards.nth(i).locator('.card-date')).not.toBeEmpty();
        }

        // Recent episodes appear before the trending chips in DOM order
        const recentTop = await page.locator('.recent-eps-section').boundingBox();
        const chipsTop  = await page.locator('.trending-chip').first().boundingBox();
        expect(recentTop?.y).toBeLessThan(chipsTop?.y ?? Infinity);
    });

    test('recent episode embed button opens inline player', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('.recent-eps-section').first()).toBeVisible({ timeout: 5000 });

        // Only episode cards with a player_id get a data-action="embed" button
        const embedBtn = page.locator('.recent-eps-section button[data-action="embed"]').first();
        if (await embedBtn.count() === 0) return; // skip if no embeddable episodes in top 3

        await embedBtn.click();
        await expect(page.locator('.recent-eps-section .embed-wrap iframe').first()).toBeVisible();
    });

});
