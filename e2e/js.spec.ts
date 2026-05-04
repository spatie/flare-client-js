import { expect, test } from './fixtures/flare-interceptor';

test.describe('JS playground', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/js/');
    });

    test.describe('TypeError section', () => {
        test('TypeError sends report', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.exceptionClass === 'TypeError' || (r.message?.includes('null') ?? false),
            });
            await page.getByRole('button', { name: 'TypeError (null access)' }).click();
            const report = await reportPromise;

            expect(report.stacktrace.length).toBeGreaterThan(0);
        });
    });

    test.describe('Timeout section', () => {
        test('setTimeout error sends report', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport();
            await page.getByRole('button', { name: 'Throw error in setTimeout' }).click();
            const report = await reportPromise;

            expect(report.message).toBeDefined();
            expect(report.stacktrace.length).toBeGreaterThan(0);
        });
    });

    test.describe('CauseChain section', () => {
        test('error with cause sends report', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => (r.message?.includes('cause') ?? false) || (r.message?.includes('Outer') ?? false),
            });
            await page.getByRole('button', { name: 'Error with cause chain' }).click();
            const report = await reportPromise;

            expect(report.message).toBeDefined();
            expect(report.stacktrace.length).toBeGreaterThan(0);
        });
    });

    test.describe('PromiseRejection section', () => {
        test('promise rejection with Error sends report', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport();
            await page.getByRole('button', { name: 'Reject with Error' }).click();
            const report = await reportPromise;

            expect(report.message).toBeDefined();
            expect(report.stacktrace.length).toBeGreaterThan(0);
        });

        test('promise rejection with string sends report', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('string') ?? false,
            });
            await page.getByRole('button', { name: 'Reject with string' }).click();
            const report = await reportPromise;

            expect(report.message).toBeDefined();
        });
    });

    test.describe('ManualReporting section', () => {
        test('flare.report() sends report', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('Manually') ?? false,
            });
            await page.getByRole('button', { name: 'flare.report(error)' }).click();
            const report = await reportPromise;

            expect(report.stacktrace.length).toBeGreaterThan(0);
        });

        test('flare.reportMessage() sends log report', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.isLog === true,
            });
            await page.getByRole('button', { name: 'flare.reportMessage()' }).click();
            const report = await reportPromise;

            expect(report.isLog).toBe(true);
        });

        test('flare.test() sends synthetic report', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('Flare client is set up correctly') ?? false,
            });
            await page.getByRole('button', { name: 'flare.test()' }).click();
            const report = await reportPromise;

            expect(report.message).toContain('Flare client is set up correctly');
        });
    });

    test.describe('Enrichment section', () => {
        test('glows are included as events', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('Payment processing failed') ?? false,
            });
            await page.getByRole('button', { name: 'Error with glows' }).click();
            const report = await reportPromise;

            expect(report.events.length).toBeGreaterThanOrEqual(3);
        });

        test('custom context in attributes', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('Error with custom context attached') ?? false,
            });
            await page.getByRole('button', { name: 'Error with custom context' }).click();
            const report = await reportPromise;

            const custom = report.attributes['context.custom'] as Record<string, unknown>;
            expect(custom).toBeDefined();
            expect(custom.user_id).toBe('usr_12345');
            expect(custom.plan).toBe('pro');

            const flags = report.attributes['context.feature_flags'] as Record<string, unknown>;
            expect(flags).toBeDefined();
            expect(flags.new_checkout).toBe(true);
            expect(flags.dark_mode).toBe(false);
        });
    });

    test.describe('Hooks section', () => {
        test('beforeEvaluate suppresses report', async ({ page, flare }) => {
            const initialCount = flare.reports.length;

            const consolePromise = page.waitForEvent('console', {
                predicate: (msg) => msg.text().includes('Error was suppressed by beforeEvaluate'),
            });
            await page.getByRole('button', { name: 'beforeEvaluate (suppress)' }).click();
            await consolePromise;

            await page.waitForTimeout(500);
            expect(flare.reports.length).toBe(initialCount);
        });

        test('beforeSubmit mutates report', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('Error modified by beforeSubmit') ?? false,
            });
            await page.getByRole('button', { name: 'beforeSubmit (modify)' }).click();
            const report = await reportPromise;

            const context = report.context as Record<string, unknown> | undefined;
            expect(context).toBeDefined();
            const hook = context!.custom_hook as Record<string, unknown>;
            expect(hook).toBeDefined();
            expect(hook.injected_by).toBe('beforeSubmit hook');
        });
    });

    test.describe('RapidFire section', () => {
        test('multiple reports sent from rapid-fire errors', async ({ page, flare }) => {
            const consolePromise = page.waitForEvent('console', {
                predicate: (msg) => msg.text().includes('All 50 errors submitted'),
                timeout: 10_000,
            });
            await page.getByRole('button', { name: 'Rapid-fire 50 errors' }).click();
            await consolePromise;

            // Wait for network to settle
            await page.waitForTimeout(1000);
            expect(flare.reports.length).toBeGreaterThan(0);
        });
    });
});
