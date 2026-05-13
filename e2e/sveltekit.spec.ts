import { type Report, expect, test } from './fixtures/flare-interceptor';

function svelteContext(report: Report) {
    const custom = report.attributes['context.custom'] as Record<string, unknown> | undefined;
    return custom?.svelte as Record<string, unknown> | undefined;
}

test.describe('SvelteKit playground', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('http://localhost:5174/', { waitUntil: 'networkidle' });
    });

    test.describe('RenderError section', () => {
        test('fallback renders and report has svelte context', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('BuggyComponent render error') ?? false,
            });
            await page.getByRole('button', { name: 'Trigger render error' }).click();
            const report = await reportPromise;

            await expect(page.getByText('Something went wrong:')).toBeVisible();

            const svelte = svelteContext(report);
            expect(svelte).toBeDefined();
            expect(svelte!.errorOrigin).toBeDefined();
            expect(svelte!.componentName).toBeDefined();
            expect(svelte!.componentHierarchy).toBeDefined();
            expect(Array.isArray(svelte!.componentHierarchy)).toBe(true);
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

        test('onReset callback fires with previous error on manual reset', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('BuggyComponent render error') ?? false,
            });
            await page.getByRole('button', { name: 'Trigger render error' }).click();
            await reportPromise;

            await expect(page.getByText('Something went wrong:')).toBeVisible();

            const consolePromise = page.waitForEvent('console', {
                predicate: (msg) => msg.text().includes('FlareErrorBoundary onReset:'),
            });

            await page.getByText('Try again').click();
            const consoleMsg = await consolePromise;

            expect(consoleMsg.text()).toContain('BuggyComponent render error');
        });
    });

    test.describe('ComponentHierarchy section', () => {
        test('report includes component hierarchy from nested components', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('NestedChild render error') ?? false,
            });
            await page.getByRole('button', { name: 'Trigger nested error' }).click();
            const report = await reportPromise;

            await expect(page.getByText('Hierarchy error caught:')).toBeVisible();

            const svelte = svelteContext(report);
            expect(svelte).toBeDefined();
            expect(Array.isArray(svelte!.componentHierarchy)).toBe(true);
            const hierarchy = svelte!.componentHierarchy as string[];
            expect(hierarchy.length).toBeGreaterThanOrEqual(1);
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

        test('onReset callback fires on resetKey change', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('ConditionallyBuggyComponent error') ?? false,
            });
            await page.getByRole('button', { name: 'Trigger error' }).click();
            await reportPromise;

            const consolePromise = page.waitForEvent('console', {
                predicate: (msg) => msg.text().includes('FlareErrorBoundary onReset via resetKeys'),
            });

            await page.getByRole('button', { name: /Increment resetKey/ }).click();
            const consoleMsg = await consolePromise;

            expect(consoleMsg.text()).toContain('ConditionallyBuggyComponent error');
        });
    });

    test.describe('OnClick section', () => {
        test('onclick error sends report via handleError hook', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('Error in SvelteKit onclick handler') ?? false,
            });
            await page.getByRole('button', { name: 'Throw in onclick' }).click();
            const report = await reportPromise;

            expect(report.message).toContain('Error in SvelteKit onclick handler');
        });

        test('onclick error is reported with error message', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('Error in SvelteKit onclick handler') ?? false,
            });
            await page.getByRole('button', { name: 'Throw in onclick' }).click();
            const report = await reportPromise;

            expect(report.exceptionClass).toBe('Error');
        });
    });

    test.describe('Async section', () => {
        test('async error sends report', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('Async error in SvelteKit component') ?? false,
            });
            await page.getByRole('button', { name: 'Async error' }).click();
            const report = await reportPromise;

            expect(report.message).toContain('Async error in SvelteKit component');
        });
    });

    test.describe('ManualReporting section', () => {
        test('flare.report() sends report', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('Manually reported from SvelteKit') ?? false,
            });
            await page.getByRole('button', { name: 'flare.report() from component' }).click();
            const report = await reportPromise;

            expect(report.message).toContain('Manually reported from SvelteKit');
        });

        test('flare.reportMessage() sends log report', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.isLog === true,
            });
            await page.getByRole('button', { name: 'flare.reportMessage()' }).click();
            const report = await reportPromise;

            expect(report.isLog).toBe(true);
            expect(report.message).toContain('manually reported message from SvelteKit');
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
});

test.describe('SvelteKit user page', () => {
    test('error boundary works on parameterized routes', async ({ page, flare }) => {
        await page.goto('http://localhost:5174/', { waitUntil: 'networkidle' });
        await page.getByRole('link', { name: 'User 42' }).click();
        await page.waitForURL('**/users/42**');
        await page.waitForLoadState('networkidle');

        const reportPromise = flare.waitForReport({
            filter: (r) => r.message?.includes('Error on user profile') ?? false,
        });
        await page.getByRole('button', { name: 'Throw error on this route' }).click();
        const report = await reportPromise;

        expect(report.message).toContain('Error on user profile 42');
    });
});
