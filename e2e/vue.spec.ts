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

    test.describe('NonErrorThrow section', () => {
        test('string throw is converted and reported', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('plain string thrown') ?? false,
            });
            await page.getByRole('button', { name: 'Throw non-Error value' }).click();
            const report = await reportPromise;

            expect(report.message).toContain('plain string thrown from Vue @click');
        });
    });

    test.describe('VueWarning section', () => {
        test('vue warning sends report with type warning', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => {
                    const custom = r.attributes['context.custom'] as Record<string, unknown> | undefined;
                    const vue = custom?.vue as Record<string, unknown> | undefined;
                    return vue?.type === 'warning';
                },
            });
            await page.getByRole('button', { name: 'Trigger Vue warning' }).click();
            const report = await reportPromise;

            const vue = vueContext(report);
            expect(vue).toBeDefined();
            expect(vue!.type).toBe('warning');
        });
    });

    test.describe('AttachProps section', () => {
        test('report includes serialized componentProps', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('attachProps demo error') ?? false,
            });
            await page.getByRole('button', { name: 'Trigger attachProps demo' }).click();
            const report = await reportPromise;

            const vue = vueContext(report);
            expect(vue).toBeDefined();
            expect(vue!.componentProps).toBeDefined();
            const props = vue!.componentProps as Record<string, unknown>;
            const config = props.config as Record<string, unknown>;
            expect(config.theme).toBe('dark');
        });
    });

    test.describe('DenylistProps section', () => {
        test('sensitive props are redacted', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('DenylistPropsDemo threw') ?? false,
            });
            await page.getByRole('button', { name: 'Trigger default denylist demo' }).click();
            const report = await reportPromise;

            const vue = vueContext(report);
            expect(vue).toBeDefined();
            const props = vue!.componentProps as Record<string, unknown>;
            expect(props.username).toBe('alice');
            expect(props.password).toBe('[redacted]');
            expect(props.authToken).toBe('[redacted]');
            expect(props.apiKey).toBe('[redacted]');
            expect(props.sessionId).toBe('[redacted]');
            const config = props.config as Record<string, unknown>;
            expect(config.pin).toBe('[redacted]');
            expect(config.cvv).toBe('[redacted]');
            expect(config.theme).toBe('dark');
            expect(config.regular).toBe('visible');
        });
    });

    test.describe('NestedBoundaries section', () => {
        test('only inner boundary catches, one report sent', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('nested boundary test') ?? false,
            });
            await page.getByRole('button', { name: 'Trigger nested boundaries' }).click();
            const report = await reportPromise;

            await expect(page.getByText('Inner boundary caught:')).toBeVisible();
            await expect(page.getByText('OUTER boundary rendered')).not.toBeVisible();

            expect(report.message).toContain('Error thrown inside nested boundary test');

            // Wait briefly then verify no second report arrived
            await page.waitForTimeout(500);
            const nestedReports = flare.reports.filter((r) => r.message?.includes('nested boundary test') ?? false);
            expect(nestedReports).toHaveLength(1);
        });
    });

    test.describe('ManualReporting section', () => {
        test('flare.report() sends report', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.message?.includes('Manually reported from Vue') ?? false,
            });
            await page.getByRole('button', { name: 'flare.report() from component' }).click();
            const report = await reportPromise;

            expect(report.message).toContain('Manually reported from Vue');
        });

        test('flare.reportMessage() sends log report', async ({ page, flare }) => {
            const reportPromise = flare.waitForReport({
                filter: (r) => r.isLog === true,
            });
            await page.getByRole('button', { name: 'flare.reportMessage()' }).click();
            const report = await reportPromise;

            expect(report.isLog).toBe(true);
            expect(report.message).toContain('manually reported message from Vue');
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

        test('custom context is included in attributes', async ({ page, flare }) => {
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

            // Wait briefly to ensure no report arrives
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
            expect(hook.timestamp).toBeGreaterThan(0);
        });
    });
});

test.describe('Vue route context', () => {
    test('report includes route path, params, and query', async ({ page, flare }) => {
        await page.goto('/vue/');
        await page.getByRole('link', { name: 'User 42' }).click();
        await page.waitForURL('**/users/42**');

        const reportPromise = flare.waitForReport({
            filter: (r) => r.message?.includes('Error on user profile') ?? false,
        });
        await page.getByRole('button', { name: 'Throw error on this route' }).click();
        const report = await reportPromise;

        const vue = vueContext(report);
        expect(vue).toBeDefined();
        const route = vue!.route as Record<string, unknown>;
        expect(route).toBeDefined();
        expect(route.path).toBe('/users/42');
        expect((route.params as Record<string, unknown>).id).toBe('42');
        expect((route.query as Record<string, unknown>).tab).toBe('settings');
    });
});

test.describe('Vue route denylist', () => {
    test('sensitive query params are redacted', async ({ page, flare }) => {
        await page.goto('/vue/');
        await page.getByRole('link', { name: 'User 77 (denylisted query)' }).click();
        await page.waitForURL('**/users/77**');

        const reportPromise = flare.waitForReport({
            filter: (r) => r.message?.includes('Route denylist demo error') ?? false,
        });
        await page.getByRole('button', { name: /Route denylist demo/ }).click();
        const report = await reportPromise;

        const vue = vueContext(report);
        expect(vue).toBeDefined();
        const route = vue!.route as Record<string, unknown>;
        expect(route).toBeDefined();
        const query = route.query as Record<string, unknown>;
        expect(query.token).toBe('[redacted]');
        expect(query.session_id).toBe('[redacted]');
        expect(query.tab).toBe('public');
    });
});
