import { FakeApi } from '@flareapp/test-helpers';
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { Flare } from '../src/browser';
import { stopBrowserTracing } from '../src/tracing/roots';
import { activeComponentRoot, recordComponentSpan, reserveSpanId } from '../src/tracing/roots';

function spansOf(api: FakeApi) {
    return api.traceEnvelopes.flatMap((e) => e.resourceSpans[0].scopeSpans[0].spans);
}

// Mounts a nested tree the way a framework does: reserve top-down, record bottom-up.
function mountTree(depth: number) {
    const root = activeComponentRoot()!;
    const reserved: Array<{ name: string; spanId: string; parent: { traceId: string; parentSpanId: string } }> = [];
    let parent = root;
    for (let level = 0; level < depth; level++) {
        const spanId = reserveSpanId(parent.traceId);
        if (!spanId) {
            break;
        }
        reserved.push({ name: `Component${level}`, spanId, parent });
        parent = { traceId: parent.traceId, parentSpanId: spanId };
    }
    for (const entry of [...reserved].toReversed()) {
        recordComponentSpan({ ...entry, startTimeUnixNano: 1, endTimeUnixNano: 2 });
    }
    return { root, reserved };
}

describe('component spans against maxSpansPerTrace', () => {
    afterEach(() => {
        stopBrowserTracing();
    });

    it('never publishes a parent id the cap will refuse', () => {
        const api = new FakeApi();
        const flare = new Flare(api);
        flare.configure({ key: 'k', enableTracing: true, maxSpansPerTrace: 6 });

        const { root } = mountTree(20);
        flare.flush();

        const spans = spansOf(api);
        const emitted = new Set(spans.map((s) => s.spanId));
        const components = spans.filter((s) => s.name.startsWith('Component'));

        expect(components.length).toBeGreaterThan(0);
        for (const span of components) {
            if (span.parentSpanId && span.parentSpanId !== root.parentSpanId) {
                expect(emitted.has(span.parentSpanId)).toBe(true);
            }
        }
    });

    it('stops reserving once the trace is full', () => {
        const api = new FakeApi();
        const flare = new Flare(api);
        flare.configure({ key: 'k', enableTracing: true, maxSpansPerTrace: 4 });

        const { reserved } = mountTree(50);

        // one slot went to the pageload root itself
        expect(reserved.length).toBe(3);
    });

    it('records the whole tree when the cap is not in the way', () => {
        const api = new FakeApi();
        const flare = new Flare(api);
        flare.configure({ key: 'k', enableTracing: true });

        mountTree(10);
        flare.flush();

        expect(spansOf(api).filter((s) => s.name.startsWith('Component'))).toHaveLength(10);
    });
});
