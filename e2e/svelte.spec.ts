import { type Report, expect, test } from './fixtures/flare-interceptor';

function svelteContext(report: Report) {
    const custom = report.attributes['context.custom'] as Record<string, unknown> | undefined;
    return custom?.svelte as Record<string, unknown> | undefined;
}

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
            await page.getByRole('button', { name: 'Trigger error', exact: true }).click();
            await reportPromise;

            await expect(page.getByText('Boundary caught:')).toBeVisible();

            await page.getByRole('button', { name: /Increment resetKey/ }).click();
            await expect(page.getByText('Boundary caught:')).not.toBeVisible();
            await expect(page.getByText('Child rendered successfully')).toBeVisible();
        });
    });

    test.describe('ComponentTree section', () => {
        test('sidebar error reports hierarchy with SidebarBuggyButton parent', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('BuggyButton render error') ?? false,
            });
            await page.getByRole('button', { name: 'Trigger error in Sidebar' }).click();
            const report = await reportPromise;

            await expect(page.locator('text=Sidebar caught:')).toBeVisible();

            const svelte = svelteContext(report);
            expect(svelte).toBeDefined();
            const hierarchy = svelte!.componentHierarchy as string[];
            expect(hierarchy[0]).toBe('BuggyButton');
            expect(hierarchy).toContain('SidebarBuggyButton');
            expect(hierarchy).not.toContain('HeaderBuggyButton');
        });

        test('header error reports hierarchy with HeaderBuggyButton parent', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('BuggyButton render error') ?? false,
            });
            await page.getByRole('button', { name: 'Trigger error in Header' }).click();
            const report = await reportPromise;

            await expect(page.locator('text=Header caught:')).toBeVisible();

            const svelte = svelteContext(report);
            expect(svelte).toBeDefined();
            const hierarchy = svelte!.componentHierarchy as string[];
            expect(hierarchy[0]).toBe('BuggyButton');
            expect(hierarchy).toContain('HeaderBuggyButton');
            expect(hierarchy).not.toContain('SidebarBuggyButton');
        });

        test('both instances can error independently', async ({ page, flare }) => {
            const sidebarReportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('BuggyButton render error') ?? false,
            });
            await page.getByRole('button', { name: 'Trigger error in Sidebar' }).click();
            await sidebarReportPromise;

            await expect(page.locator('text=Sidebar caught:')).toBeVisible();
            await expect(page.getByRole('button', { name: 'I am a BuggyButton' })).toBeVisible();

            const headerReportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('BuggyButton render error') ?? false,
            });
            await page.getByRole('button', { name: 'Trigger error in Header' }).click();
            await headerReportPromise;

            await expect(page.locator('text=Header caught:')).toBeVisible();
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
