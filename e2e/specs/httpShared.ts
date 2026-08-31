import { expect, type Page } from '@playwright/test';

import { testIds } from '../../playgrounds/shared/src';
import type { FakeFlare } from '../fixtures/fake-flare';
import { attr, hasSpanType, parentOf, spansOf, urlOf, type OtlpSpan } from './otlp';

export type BrowserHttpSpanType = 'browser_fetch' | 'browser_xhr';

// Land on /http through an in-app link, never `goto`. On a slow machine `goto` plus `networkidle`
// can burn the whole idleTimeout, leaving no live root for the request to nest under.
export const openHttpPage = async (page: Page): Promise<void> => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.getByRole('link', { name: 'HTTP' }).click();
    await expect(page).toHaveURL(/\/http$/);
};

// Find the span for one scenario across every envelope captured so far.
const findSpan = async (
    fakeFlare: FakeFlare,
    spanType: BrowserHttpSpanType,
    scenario: string,
): Promise<OtlpSpan | undefined> => {
    const matches = (span: OtlpSpan): boolean => hasSpanType(span, spanType) && urlOf(span).includes(scenario);
    const trace = await fakeFlare.waitForTrace({
        timeout: 9000,
        predicate: (record) => spansOf(record.bodyJson).some(matches),
    });
    return spansOf(trace.bodyJson).find(matches);
};

// Click one /http trigger and assert its span nests under the live root rather than opening a trace.
export const assertNestedHttpSpan = async (
    page: Page,
    fakeFlare: FakeFlare,
    options: { scenario: string; spanType: BrowserHttpSpanType },
): Promise<void> => {
    const { scenario, spanType } = options;

    await page.getByTestId(testIds.httpTrigger(scenario)).click();
    await expect(page.getByTestId(testIds.httpResult)).toHaveText(`${scenario}:200`);

    const span = await findSpan(fakeFlare, spanType, scenario);
    expect(span).toBeTruthy();
    expect(attr(span!, 'http.request.method')).toEqual({ stringValue: 'GET' });

    expect(span!.parentSpanId).toBeTruthy();
    const root = await parentOf(fakeFlare, span!);
    expect(root).toBeTruthy();
    expect(hasSpanType(root!, 'browser_pageload') || hasSpanType(root!, 'browser_navigation')).toBe(true);
};

// Covers the case only svelte.spec.ts otherwise hits: a request fired while the navigation root is
// still held (a loader in react-router, a route guard in Vue) must nest under that root.
export const assertNavigationRequestNests = async (page: Page, fakeFlare: FakeFlare): Promise<void> => {
    const span = await findSpan(fakeFlare, 'browser_fetch', 'loader-fetch');
    expect(span).toBeTruthy();
    expect(span!.parentSpanId).toBeTruthy();

    const root = await parentOf(fakeFlare, span!);
    expect(root && hasSpanType(root, 'browser_navigation')).toBe(true);
    expect(root!.traceId).toBe(span!.traceId);
};
