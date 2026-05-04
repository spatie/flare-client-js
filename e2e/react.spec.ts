import { type Report, expect, test } from './fixtures/flare-interceptor';

test.describe('React playground', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/react/');
    });

    test.describe('RenderError section', () => {
        test('fallback renders and report is sent with componentStack', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport();
            await page.getByRole('button', { name: 'Trigger render error' }).click();
            const report = await reportPromise;

            await expect(page.getByText('Something went wrong:')).toBeVisible();

            expect(report.message).toContain('BuggyComponent render error');
            expect(report.stacktrace.length).toBeGreaterThan(0);
            expect(report.seenAtUnixNano).toBeGreaterThan(0);

            const custom = report.attributes['context.custom'] as Record<string, unknown>;
            expect(custom).toBeDefined();
            expect(custom.react).toBeDefined();
            const react = custom.react as Record<string, unknown>;
            expect(react.componentStack).toBeDefined();
            expect(Array.isArray(react.componentStack)).toBe(true);
        });

        test('reset render error button unmounts boundary and clears fallback', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport();
            await page.getByRole('button', { name: 'Trigger render error' }).click();
            await reportPromise;

            await expect(page.getByText('Something went wrong:')).toBeVisible();
            await page.getByRole('button', { name: 'Reset render error' }).click();
            await expect(page.getByText('Something went wrong:')).not.toBeVisible();
        });
    });

    test.describe('ResetKeys section', () => {
        test('resetKeys auto-resets boundary after error', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('ConditionallyBuggyComponent') ?? false,
            });

            await page.getByRole('button', { name: 'Trigger error' }).click();
            await reportPromise;

            await expect(page.getByText('Boundary caught: ConditionallyBuggyComponent render error')).toBeVisible();

            await page.getByRole('button', { name: 'Increment resetKey (auto-reset)' }).click();

            await expect(page.getByText('ConditionallyBuggyComponent rendered successfully!')).toBeVisible();
        });
    });

    test.describe('OnClick section', () => {
        test('onClick error sends report', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('onClick handler') ?? false,
            });
            await page.getByRole('button', { name: 'Throw in onClick' }).click();
            const report = await reportPromise;

            expect(report.message).toContain('Error in React onClick handler');
            expect(report.stacktrace.length).toBeGreaterThan(0);
        });
    });

    test.describe('Async section', () => {
        test('async error sends report', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('Async error') ?? false,
            });
            await page.getByRole('button', { name: 'Async error in useEffect' }).click();
            const report = await reportPromise;

            expect(report.message).toContain('Async error in React useEffect');
            expect(report.stacktrace.length).toBeGreaterThan(0);
        });
    });

    test.describe('ManualReport section', () => {
        test('flare.report() sends report', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('Manually reported') ?? false,
            });
            await page.getByRole('button', { name: 'flare.report() from component' }).click();
            const report = await reportPromise;

            expect(report.message).toContain('Manually reported from React');
            expect(report.stacktrace.length).toBeGreaterThan(0);
        });
    });
});
