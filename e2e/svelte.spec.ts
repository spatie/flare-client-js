import { expect, test } from './fixtures/flare-interceptor';

test.describe('Svelte playground', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/svelte/');
    });

    test.describe('RenderError section', () => {
        test('fallback renders and report is sent', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('BuggyComponent render error') ?? false,
            });
            await page.getByRole('button', { name: 'Trigger render error' }).click();
            const report = await reportPromise;

            await expect(page.getByText('Something went wrong:')).toBeVisible();
            expect(report.stacktrace.length).toBeGreaterThan(0);
        });

        test('reset clears fallback', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('BuggyComponent render error') ?? false,
            });
            await page.getByRole('button', { name: 'Trigger render error' }).click();
            await reportPromise;

            await expect(page.getByText('Something went wrong:')).toBeVisible();
            await page.getByRole('button', { name: 'Reset render error' }).click();
            await expect(page.getByText('Something went wrong:')).not.toBeVisible();
        });
    });

    test.describe('ResetKeys section', () => {
        test('auto-resets boundary when resetKey changes', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('ConditionallyBuggyComponent error') ?? false,
            });
            await page.getByRole('button', { name: 'Trigger error' }).click();
            await reportPromise;

            await expect(page.getByText('Boundary caught:')).toBeVisible();

            await page.getByRole('button', { name: /Increment resetKey/ }).click();
            await expect(page.getByText('Boundary caught:')).not.toBeVisible();
            await expect(page.getByText('Child rendered successfully')).toBeVisible();
        });
    });

    test.describe('OnClick section', () => {
        test('onclick error sends report', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('Error in Svelte onclick handler') ?? false,
            });
            await page.getByRole('button', { name: 'Throw in onclick' }).click();
            const report = await reportPromise;

            expect(report.message).toContain('Error in Svelte onclick handler');
        });
    });

    test.describe('Async section', () => {
        test('async error sends report', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('Async error in Svelte component') ?? false,
            });
            await page.getByRole('button', { name: 'Async error' }).click();
            const report = await reportPromise;

            expect(report.message).toContain('Async error in Svelte component');
        });
    });

    test.describe('ManualReport section', () => {
        test('flare.report() sends report', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('Manually reported from Svelte') ?? false,
            });
            await page.getByRole('button', { name: 'flare.report() from component' }).click();
            const report = await reportPromise;

            expect(report.message).toContain('Manually reported from Svelte');
        });
    });
});
