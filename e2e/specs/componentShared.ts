import { expect, type Page } from '@playwright/test';

import type { FakeFlare } from '../fixtures/fake-flare';
import { hasSpanType, intAttr, parentOf, spansOf, stringAttr, type OtlpSpan } from './otlp';

const isComponent = (span: OtlpSpan, name: string): boolean =>
    hasSpanType(span, 'browser_component') && stringAttr(span, 'flare.component.name') === name;

// Every component span captured so far. A commit's spans can straddle two flush envelopes, so collect across all of them.
export const componentSpans = async (fakeFlare: FakeFlare): Promise<OtlpSpan[]> =>
    (await fakeFlare.traces()).flatMap((t) => spansOf(t.bodyJson)).filter((s) => hasSpanType(s, 'browser_component'));

// How many spans a component recorded across the run. Unlike the `find`/`some` checks elsewhere here,
// this can catch a duplicate, e.g. a record-once guard regressing under React StrictMode.
export const componentSpanCount = async (fakeFlare: FakeFlare, name: string): Promise<number> =>
    (await componentSpans(fakeFlare)).filter((s) => isComponent(s, name)).length;

export const waitForComponentSpan = async (fakeFlare: FakeFlare, name: string): Promise<OtlpSpan> => {
    const trace = await fakeFlare.waitForTrace({
        timeout: 9000,
        predicate: (record) => spansOf(record.bodyJson).some((s) => isComponent(s, name)),
    });
    const span = spansOf(trace.bodyJson).find((s) => isComponent(s, name));
    expect(span).toBeTruthy();
    return span!;
};

// Every component span carries its self time, and it never exceeds the span's own duration.
// How much lower it runs is framework-specific: React mounts a whole tree in one commit, while
// vue-router resolves the initial route after the layout mounted, so a Vue layout keeps its full
// duration. react.spec.ts pins the subtraction itself.
export const assertSelfTime = (span: OtlpSpan): number => {
    const selfTime = intAttr(span, 'flare.component.self_time_ns');

    expect(selfTime).toBeGreaterThanOrEqual(0);
    expect(selfTime).toBeLessThanOrEqual(span.endTimeUnixNano - span.startTimeUnixNano);

    return selfTime!;
};

// `outer` is the outermost profiled component, so its parent is the root. `inner` hangs off `outer`,
// not the root: `resolveComponentParent` prefers the nearest live ancestor marker (componentProfiler.ts:36-44).
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

    assertSelfTime(outer);
    assertSelfTime(inner!);
};
