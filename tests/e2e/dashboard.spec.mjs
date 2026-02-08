/**
 * Riistakamera Dashboard — E2E tests (Playwright)
 * Run against live instance: npx playwright test
 * Requires the app to be running at BASE_URL
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://100.93.64.41:5000';

test.describe('Dashboard E2E', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto(BASE_URL + '/');
        // Wait for dashboard data to load
        await page.waitForFunction(() => {
            const el = document.getElementById('kpi-total');
            return el && el.textContent !== '—';
        }, { timeout: 15000 });
    });

    // 1. Page load
    test('sivu latautuu oikein', async ({ page }) => {
        await expect(page).toHaveTitle(/Analytiikka/);
    });

    // 2. KPI cards
    test('6 KPI-korttia renderöityvät arvoineen', async ({ page }) => {
        const kpis = page.locator('.dash-kpi');
        await expect(kpis).toHaveCount(6);

        // None should show dash placeholder
        const values = page.locator('.dash-kpi__value');
        for (let i = 0; i < 6; i++) {
            const text = await values.nth(i).textContent();
            // At minimum, total images should be a number
            expect(text).not.toBe('—');
        }
    });

    // 3. Charts
    test('5 canvas-elementtiä renderöityvät', async ({ page }) => {
        const canvases = page.locator('#view-overview canvas');
        const count = await canvases.count();
        expect(count).toBe(5);
    });

    // 4. Species chips
    test('9 lajinappia renderöityvät', async ({ page }) => {
        const chips = page.locator('.dash-chip');
        await expect(chips).toHaveCount(9);
    });

    // 5. Chip click
    test('chipin klikkaus aktivoi suodattimen', async ({ page }) => {
        const firstChip = page.locator('.dash-chip').first();
        await firstChip.click();
        await expect(firstChip).toHaveClass(/active/);

        // Wait for reload with species param
        await page.waitForResponse(resp =>
            resp.url().includes('/api/dashboard') && resp.url().includes('species=')
        );
    });

    // 6. Date filter
    test('päivämääräsuodatus lähettää API-kutsun', async ({ page }) => {
        const fromInput = page.locator('#filter-from');
        await fromInput.fill('2026-01-28');

        // Debounce triggers after 300ms
        const response = await page.waitForResponse(resp =>
            resp.url().includes('/api/dashboard') && resp.url().includes('from_date='),
            { timeout: 5000 }
        );
        expect(response.status()).toBe(200);
    });

    // 7. Reset button
    test('Nollaa-nappi tyhjentää filtterit', async ({ page }) => {
        // Activate a chip first
        const firstChip = page.locator('.dash-chip').first();
        await firstChip.click();
        await expect(firstChip).toHaveClass(/active/);

        // Click reset
        await page.locator('#btn-reset').click();
        await expect(firstChip).not.toHaveClass(/active/);
    });

    // 8. Recent feed
    test('viimeisimmät havainnot -feed näyttää kuvia', async ({ page }) => {
        const feedItems = page.locator('.dash-feed-item');
        const count = await feedItems.count();

        if (count > 0) {
            // Check that thumbnails are present
            const firstThumb = feedItems.first().locator('.dash-feed-thumb');
            await expect(firstThumb).toBeVisible();

            // Species and date visible
            const species = feedItems.first().locator('.dash-feed-species');
            await expect(species).toBeVisible();
        }
    });

    // 9. Annotator link
    test('annotaattori-linkki on oikein', async ({ page }) => {
        const link = page.locator('a.dash-btn--annotator');
        await expect(link).toHaveAttribute('href', '/annotator');
        await expect(link).toHaveAttribute('target', '_blank');
    });

    // 10. Responsive 375px
    test('responsiivinen näkymä 375px', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 812 });
        await page.goto(BASE_URL + '/');
        await page.waitForFunction(() => {
            const el = document.getElementById('kpi-total');
            return el && el.textContent !== '—';
        }, { timeout: 15000 });

        // KPI grid should have 2 columns (check computed style)
        const kpiGrid = page.locator('.dash-kpi-grid');
        const gridCols = await kpiGrid.evaluate(el =>
            getComputedStyle(el).gridTemplateColumns
        );
        // Should be 2 columns (2 values separated by space)
        const colCount = gridCols.split(' ').length;
        expect(colCount).toBe(2);
    });

    // 11. Tab navigation
    test('välilehtien vaihto toimii', async ({ page }) => {
        // Click table tab
        await page.locator('.dash-tab[data-view="table"]').click();
        await expect(page.locator('#view-table')).toBeVisible();
        await expect(page.locator('#view-overview')).toBeHidden();

        // Click gallery tab
        await page.locator('.dash-tab[data-view="gallery"]').click();
        await expect(page.locator('#view-gallery')).toBeVisible();
        await expect(page.locator('#view-table')).toBeHidden();

        // Click back to overview
        await page.locator('.dash-tab[data-view="overview"]').click();
        await expect(page.locator('#view-overview')).toBeVisible();
    });

    // 12. Quick date buttons
    test('pikavalintanapit asettavat päivämäärät', async ({ page }) => {
        await page.locator('.dash-btn--quick[data-range="7"]').click();
        const fromVal = await page.locator('#filter-from').inputValue();
        const toVal = await page.locator('#filter-to').inputValue();
        expect(fromVal).toBeTruthy();
        expect(toVal).toBeTruthy();
    });

    // 13. Loading state
    test('loading-spinner näkyy latauksen aikana', async ({ page }) => {
        // Navigate fresh — the loading spinner should appear briefly
        const loadingVisible = page.locator('#dash-loading.visible');
        // Intercept to slow down response
        await page.route('**/api/dashboard*', async route => {
            await new Promise(r => setTimeout(r, 500));
            await route.continue();
        });
        await page.goto(BASE_URL + '/');
        // Spinner should be visible during the delayed request
        await expect(loadingVisible).toBeVisible({ timeout: 2000 });
    });
});

test.describe('Dashboard Screenshots', () => {

    test('oletuslataus screenshot', async ({ page }) => {
        await page.goto(BASE_URL + '/');
        await page.waitForFunction(() => {
            const el = document.getElementById('kpi-total');
            return el && el.textContent !== '—';
        }, { timeout: 15000 });

        // Mask dynamic values
        await expect(page).toHaveScreenshot('dashboard-default.png', {
            maxDiffPixelRatio: 0.01,
            mask: [
                page.locator('#update-time'),
                page.locator('.dash-kpi__value'),
            ],
        });
    });

    test('mobiili screenshot 375px', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 812 });
        await page.goto(BASE_URL + '/');
        await page.waitForFunction(() => {
            const el = document.getElementById('kpi-total');
            return el && el.textContent !== '—';
        }, { timeout: 15000 });

        await expect(page).toHaveScreenshot('dashboard-mobile.png', {
            maxDiffPixelRatio: 0.01,
            mask: [
                page.locator('#update-time'),
                page.locator('.dash-kpi__value'),
            ],
        });
    });
});
