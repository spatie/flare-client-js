import type { Page } from '@playwright/test';

import { testIds } from '../../playgrounds/shared/src';
import type { FakeFlare } from '../fixtures/fake-flare';
import { expect, test } from '../fixtures/fake-flare';
import { expectedVitals } from './engines';
import { attr, attributeKeys, spansOf } from './otlp';

const PREFIX = 'browser.web_vital.';

/** Every vital name that reached the ingest, across every envelope captured so far. */
const vitalsReported = async (fakeFlare: FakeFlare): Promise<string[]> => {
    const names = new Set<string>();
    for (const record of await fakeFlare.traces()) {
        for (const span of spansOf(record.bodyJson)) {
            for (const key of attributeKeys(span)) {
                if (key.startsWith(PREFIX)) {
                    names.add(key.slice(PREFIX.length));
                }
            }
        }
    }
    return [...names].toSorted();
};

/** Latest value seen for each reported vital, across every envelope captured so far. */
const vitalValues = async (fakeFlare: FakeFlare): Promise<Record<string, number>> => {
    const values: Record<string, number> = {};
    for (const record of await fakeFlare.traces()) {
        for (const span of spansOf(record.bodyJson)) {
            for (const key of attributeKeys(span)) {
                if (key.startsWith(PREFIX)) {
                    const value = attr(span, key) as { intValue?: number; doubleValue?: number } | undefined;
                    const number = value?.intValue ?? value?.doubleValue;
                    if (typeof number === 'number') {
                        values[key.slice(PREFIX.length)] = number;
                    }
                }
            }
        }
    }
    return values;
};

/**
 * A full page life: load, interact, leave. The click has to happen before any navigation or INP is
 * never recorded, and pagehide is what flushes the late vitals span.
 */
const liveAndLeave = async (page: Page): Promise<void> => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.getByTestId(testIds.addToCart('1')).click();
    await page.mouse.wheel(0, 600);
    // Gives LCP and INP time to be observed while the page is still alive. Load-bearing: no
    // amount of polling after the page is gone substitutes for letting it live first.
    await page.waitForTimeout(1500);
    await page.goto('about:blank');
};

test.describe('web vitals', () => {
    // Exact set equality, not a subset, and that single assertion covers both claims. `vitalAttributes`
    // writes a key for any number, so a cls of 0 would still produce `browser.web_vital.cls`
    // (packages/js/src/tracing/webVitals.ts:44). The key being absent on Firefox and WebKit is therefore
    // the proof that webVitals.ts keeps an unreported vital absent rather than zero, which it promises in
    // a comment and nothing verified until now. On Chromium the same assertion proves cls does arrive.
    test('reports every vital this engine supports and nothing it does not', async ({
        page,
        fakeFlare,
        browserName,
    }) => {
        await liveAndLeave(page);

        const expected = expectedVitals(browserName).toSorted();

        // The late vitals span flushes on pagehide via a keepalive beacon, which can still be in
        // flight once the navigation above resolves. Poll like the otlp helpers do instead of a
        // fixed sleep: a slow engine gets more time, and a vital that never arrives still fails,
        // just after the timeout instead of immediately.
        await expect.poll(() => vitalsReported(fakeFlare), { timeout: 9000 }).toEqual(expect.arrayContaining(expected));

        expect(await vitalsReported(fakeFlare)).toEqual(expected);

        // This catches a client emitting 0, NaN or a non-number for a reported vital. It does not
        // catch a unit change (milliseconds vs. seconds), since both are plausible positive numbers.
        const values = await vitalValues(fakeFlare);
        for (const name of expected) {
            const value = values[name];
            expect(Number.isFinite(value)).toBe(true);
            expect(value).toBeGreaterThanOrEqual(0);
        }
        // Only these three are guaranteed strictly positive for a real page load. cls can be exactly 0
        // (a perfect score, no layout shift) and inp can legitimately round to 0 for a fast interaction.
        for (const name of ['ttfb', 'fcp', 'lcp']) {
            expect(values[name]).toBeGreaterThan(0);
        }
    });
});
