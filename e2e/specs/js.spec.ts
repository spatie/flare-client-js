import { testIds } from '../../playgrounds/shared/src';
import { expect, test } from '../fixtures/fake-flare';
import { logScenariosFor, runLogScenario } from './logShared';
import { runScenario, scenariosFor } from './shared';

test.describe('js playground', () => {
    test('renders product grid', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByTestId(testIds.productGrid)).toBeVisible();
    });

    test('checkout happy path reports no errors', async ({ page, fakeFlare }) => {
        await page.goto('/');
        await page.getByTestId(testIds.addToCart('p01')).click();
        await page.goto('/cart');
        await expect(page.getByTestId(testIds.cartItem('p01'))).toBeVisible();
        await page.getByRole('link', { name: 'Checkout' }).click();
        await page.getByTestId(testIds.checkoutSubmit).click();
        await expect(page.getByTestId(testIds.confirmation)).toBeVisible();
        await fakeFlare.assertNoReports();
    });

    test.describe('error scenarios', () => {
        for (const scenario of scenariosFor('js')) {
            test(scenario.id, async ({ page, fakeFlare }) => {
                await page.goto('/broken');
                await runScenario(page, fakeFlare, scenario);
            });
        }
    });
});

test.describe('js logging', () => {
    for (const scenario of logScenariosFor('js').filter((s) => s.flushOnTrigger)) {
        test(scenario.id, async ({ page, fakeFlare }) => {
            await page.goto('/broken');
            await page.waitForLoadState('networkidle');
            await runLogScenario(page, fakeFlare, scenario);
        });
    }

    test('ships a buffered log on page unload (cross-origin keepalive)', async ({ page, fakeFlare }) => {
        await fakeFlare.reset();

        await page.goto('/broken');
        await page.waitForLoadState('networkidle');

        // log-unload is flushOnTrigger:false — buffered, not sent on click.
        await page.getByTestId(testIds.logTrigger('log-unload')).click();

        await page.waitForTimeout(300);
        expect(await fakeFlare.logs()).toHaveLength(0);

        await page.goto('about:blank');

        const log = await fakeFlare.waitForLog({
            predicate: (r) => JSON.stringify(r.bodyJson).includes('e2e-unload-log'),
        });

        expect(log.endpoint).toBe('logs');
        expect(log.headers['x-api-token']).toBeTruthy();
    });

    test('backgrounding a tab retains over-keepalive logs and ships them on resume', async ({ page, fakeFlare }) => {
        await fakeFlare.reset();

        await page.goto('/broken');
        await page.waitForLoadState('networkidle');

        // Lower the keepalive budget and buffer a record larger than it. visibilitychange
        // :hidden fires on backgrounding too, not only on unload, so the over-budget
        // record must survive a hidden/visible cycle instead of being dropped.
        const oversized = 'e2e-bg-resume-' + 'x'.repeat(5000);
        await page.evaluate((message) => {
            const flare = (globalThis as { __flare?: any }).__flare;
            flare.configure({ keepaliveMaxBytes: 2000, logFlushIntervalMs: 999_999 });
            flare.logger.info(message);
        }, oversized);

        // Simulate the tab being backgrounded (not unloaded).
        await page.evaluate(() => {
            Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
            document.dispatchEvent(new Event('visibilitychange'));
        });

        // Nothing fit the keepalive budget, so no envelope shipped and the record is kept.
        await page.waitForTimeout(300);
        expect(await fakeFlare.logs()).toHaveLength(0);

        // Tab resumes; a normal flush ships the retained record.
        await page.evaluate(() => {
            Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
            return (globalThis as { __flare?: any }).__flare.flush();
        });

        const log = await fakeFlare.waitForLog({
            predicate: (r) => JSON.stringify(r.bodyJson).includes('e2e-bg-resume-'),
        });
        expect(log.endpoint).toBe('logs');
    });
});
