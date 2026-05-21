import { expect, type Page } from '@playwright/test';

import { coverageFor, testIds, type Framework, type ErrorScenario } from '../../playgrounds/shared/src';
import type { FakeFlare, FakeFlareRecord } from '../fixtures/fake-flare';

export const messageOf = (record: FakeFlareRecord): string | undefined => {
    const body = record.bodyJson as { message?: string } | null;
    return body?.message ?? undefined;
};

const assertCommonReportShape = (body: Record<string, unknown>, expectedMessage: string): void => {
    expect(body.message).toBe(expectedMessage);
    expect(Array.isArray(body.stacktrace)).toBe(true);
    expect((body.stacktrace as unknown[]).length).toBeGreaterThan(0);
};

const assertScenarioAttributes = (scenario: ErrorScenario, body: Record<string, unknown>): void => {
    if (scenario.id === 'glow-then-throw') {
        const events = body.events as unknown[];
        expect(events.length).toBeGreaterThanOrEqual(3);
    }
    if (scenario.id === 'hook-mutate-report') {
        const attributes = body.attributes as Record<string, unknown>;
        const hook = attributes['context.custom_hook'] as Record<string, unknown> | undefined;
        expect(hook).toBeDefined();
        expect(hook?.injectedBy).toBe('beforeSubmit');
    }
    if (scenario.id === 'manual-report') {
        const attributes = body.attributes as Record<string, unknown>;
        const ctx = attributes['context.scenario'] as Record<string, unknown> | undefined;
        expect(ctx).toBeDefined();
        expect(ctx?.userId).toBe('usr_42');
    }
};

export const runScenario = async (page: Page, fakeFlare: FakeFlare, scenario: ErrorScenario): Promise<void> => {
    if (scenario.kind === 'sveltekitServer') {
        const reportPromise = fakeFlare.waitForReport({
            predicate: (record) => messageOf(record) === scenario.expectedMessage,
            timeout: 10_000,
        });
        await page.getByTestId(testIds.brokenTrigger(scenario.id)).click();
        const report = await reportPromise;
        const body = report.bodyJson as Record<string, unknown>;
        assertCommonReportShape(body, scenario.expectedMessage);
        return;
    }

    if (scenario.expectedReports === 0) {
        await page.getByTestId(testIds.brokenTrigger(scenario.id)).click();
        await fakeFlare.assertNoReports();
        return;
    }

    const reportPromise = fakeFlare.waitForReport({
        predicate: (record) => messageOf(record) === scenario.expectedMessage,
    });

    await page.getByTestId(testIds.brokenTrigger(scenario.id)).click();
    const report = await reportPromise;
    const body = report.bodyJson as Record<string, unknown>;
    assertCommonReportShape(body, scenario.expectedMessage);
    assertScenarioAttributes(scenario, body);

    if (scenario.kind === 'render' || scenario.kind === 'boundaryReset') {
        await expect(page.getByTestId(testIds.boundaryFallback)).toBeVisible();
    }

    if (scenario.kind === 'boundaryReset') {
        await page.getByTestId(testIds.boundaryReset).click();
        await expect(page.getByTestId(testIds.boundaryFallback)).toBeHidden();
    }
};

export const scenariosFor = (framework: Framework): ErrorScenario[] => coverageFor(framework);
