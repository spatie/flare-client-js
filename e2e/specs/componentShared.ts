import { expect, type Page } from '@playwright/test';

import type { FakeFlare } from '../fixtures/fake-flare';
import { attr, hasSpanType, parentOf, spansOf, type OtlpSpan } from './otlp';

const isComponent = (span: OtlpSpan, name: string): boolean =>
    hasSpanType(span, 'browser_component') &&
    JSON.stringify(attr(span, 'flare.component.name') ?? '').includes(`"${name}"`);

/**
 * Every component span captured so far. A commit records the whole profiled subtree at once, but the
 * spans can still straddle two flush envelopes, so collect across all of them rather than one.
 */
export const componentSpans = async (fakeFlare: FakeFlare): Promise<OtlpSpan[]> =>
    (await fakeFlare.traces()).flatMap((t) => spansOf(t.bodyJson)).filter((s) => hasSpanType(s, 'browser_component'));

export const waitForComponentSpan = async (fakeFlare: FakeFlare, name: string): Promise<OtlpSpan> => {
    const trace = await fakeFlare.waitForTrace({
        timeout: 9000,
        predicate: (record) => spansOf(record.bodyJson).some((s) => isComponent(s, name)),
    });
    const span = spansOf(trace.bodyJson).find((s) => isComponent(s, name));
    expect(span).toBeTruthy();
    return span!;
};

/**
 * `outer` is the outermost profiled component, so it is the only one whose parent is the root.
 * `inner` hangs off `outer`, not off the root: `resolveComponentParent` prefers the nearest live
 * ancestor marker (componentProfiler.ts:36-44).
 */
export const assertComponentTree = async (
    page: Page,
    fakeFlare: FakeFlare,
    options: { outer: string; inner: string; rootType: 'browser_pageload' | 'browser_navigation' },
): Promise<void> => {
    const outer = await waitForComponentSpan(fakeFlare, options.outer);
    const all = await componentSpans(fakeFlare);
    const inner = all.find((s) => isComponent(s, options.inner));

    expect(inner).toBeTruthy();
    expect(inner!.traceId).toBe(outer.traceId);
    expect(inner!.parentSpanId).toBe(outer.spanId);

    const root = await parentOf(fakeFlare, outer);
    expect(root && hasSpanType(root, options.rootType)).toBe(true);
    expect(root!.parentSpanId ?? null).toBeNull();
};
