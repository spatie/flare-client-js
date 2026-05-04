import { type Report, expect, test } from './fixtures/flare-interceptor';

function vueContext(report: Report) {
    const custom = report.attributes['context.custom'] as Record<string, unknown> | undefined;
    return custom?.vue as Record<string, unknown> | undefined;
}

test.describe('Vue playground', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/vue/');
    });

    test.describe('RenderError section', () => {
        test('fallback renders and report has vue context', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('BuggyComponent render error in Vue') ?? false,
            });
            await page.getByRole('button', { name: 'Trigger render error' }).click();
            const report = await reportPromise;

            await expect(page.getByText('Something went wrong:')).toBeVisible();

            const vue = vueContext(report);
            expect(vue).toBeDefined();
            expect(vue!.componentName).toBeDefined();
            expect(vue!.errorOrigin).toBeDefined();
            expect(vue!.componentHierarchy).toBeDefined();
            expect(Array.isArray(vue!.componentHierarchy)).toBe(true);
            expect(vue!.componentHierarchyFrames).toBeDefined();
            expect(Array.isArray(vue!.componentHierarchyFrames)).toBe(true);
        });

        test('reset clears fallback', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('BuggyComponent render error in Vue') ?? false,
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
                filter: (r) => r.message?.includes('BuggyComponent render error in Vue') ?? false,
            });
            await page.getByRole('button', { name: 'Trigger error' }).click();
            await reportPromise;

            await expect(page.getByText('Error caught:')).toBeVisible();

            await page.getByRole('button', { name: /Increment reset key/ }).click();
            await expect(page.getByText('Error caught:')).not.toBeVisible();
        });
    });

    test.describe('OnClick section', () => {
        test('report sent with errorOrigin event', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('Vue @click handler') ?? false,
            });
            await page.getByRole('button', { name: 'Throw in @click' }).click();
            const report = await reportPromise;

            const vue = vueContext(report);
            expect(vue).toBeDefined();
            expect(vue!.errorOrigin).toBe('event');
        });
    });

    test.describe('Lifecycle section', () => {
        test('report sent with errorOrigin lifecycle', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('onMounted') ?? false,
            });
            await page.getByRole('button', { name: 'Error in onMounted (origin: lifecycle)' }).click();
            const report = await reportPromise;

            const vue = vueContext(report);
            expect(vue).toBeDefined();
            expect(vue!.errorOrigin).toBe('lifecycle');
        });
    });

    test.describe('Watcher section', () => {
        test('report sent with errorOrigin watcher', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('watch callback') ?? false,
            });
            await page.getByRole('button', { name: 'Error in watch callback (origin: watcher)' }).click();
            const report = await reportPromise;

            const vue = vueContext(report);
            expect(vue).toBeDefined();
            expect(vue!.errorOrigin).toBe('watcher');
        });
    });

    test.describe('Async section', () => {
        test('async error sends report', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('Async error in Vue watch') ?? false,
            });
            await page.getByRole('button', { name: 'Async error in watch' }).click();
            const report = await reportPromise;

            expect(report.message).toContain('Async error in Vue watch');
        });
    });
});
