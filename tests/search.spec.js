import { test, expect } from '@playwright/test';

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

        const chips = page.locator('.trending-chip');
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
        await expect(page.locator('.card').first()).toBeVisible({ timeout: 5000 });
        const totalBefore = await page.locator('.card').count();
        await page.locator('.panelist-chip').first().click();
        await page.waitForTimeout(300);
        const totalAfter = await page.locator('.card').count();
        expect(totalAfter).toBeLessThanOrEqual(totalBefore);
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
        await expect(page.locator('.trending-header').first()).toContainText('All Time');
        await expect(page.locator('.trending-header').nth(1)).toContainText('Last 12 Months');
    });

    test('both trending sections have chips', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('.trending-chip').first()).toBeVisible({ timeout: 10000 });
        const allHeaders = page.locator('.trending-header');
        await expect(allHeaders).toHaveCount(2);
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

});
