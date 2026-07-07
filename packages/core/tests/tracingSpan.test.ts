import { describe, expect, it, vi } from 'vitest';

import { SpanImpl } from '../src/tracing/Span';

const deps = (over: Partial<ConstructorParameters<typeof SpanImpl>[1]> = {}) => ({
    maxAttributesPerSpan: 2,
    maxEventsPerSpan: 1,
    maxAttributesPerSpanEvent: 1,
    now: () => 999,
    onEnd: vi.fn(),
    ...over,
});

const init = (recording = true) => ({
    traceId: 'a'.repeat(32),
    spanId: 'b'.repeat(16),
    parentSpanId: null,
    name: 'op',
    startTimeUnixNano: 1,
    recording,
    epoch: 0,
});

describe('SpanImpl', () => {
    it('end() is idempotent and calls onEnd exactly once', () => {
        const d = deps();
        const span = new SpanImpl(init(), d);
        span.end();
        span.end();
        expect(d.onEnd).toHaveBeenCalledTimes(1);
    });

    it('uses an explicit end time, else the injected now()', () => {
        const span = new SpanImpl(init(), deps());
        span.end();
        expect(span.endTimeUnixNano).toBe(999);

        const span2 = new SpanImpl(init(), deps());
        span2.end(1234);
        expect(span2.endTimeUnixNano).toBe(1234);
    });

    it('enforces the span attribute cap and counts drops', () => {
        const span = new SpanImpl(init(), deps());
        span.setAttribute('a', 1).setAttribute('b', 2).setAttribute('c', 3);
        expect(Object.keys(span.attributes)).toEqual(['a', 'b']);
        expect(span.droppedAttributesCount).toBe(1);
    });

    it('enforces the event cap and the per-event attribute cap', () => {
        const span = new SpanImpl(init(), deps());
        span.addEvent('first', { x: 1, y: 2 }); // y dropped (cap 1)
        span.addEvent('second'); // dropped (event cap 1)
        expect(span.events).toHaveLength(1);
        expect(span.events[0].name).toBe('first');
        expect(span.events[0].droppedAttributesCount).toBe(1);
        expect(span.droppedEventsCount).toBe(1);
    });

    it('records an Error status with a message', () => {
        const span = new SpanImpl(init(), deps());
        span.setStatus({ code: 2, message: 'boom' });
        expect(span.status).toEqual({ code: 2, message: 'boom' });
    });

    it('mutation after end() is a no-op', () => {
        const span = new SpanImpl(init(), deps());
        span.end();
        span.setAttribute('late', 1).addEvent('late');
        expect(span.attributes).toEqual({});
        expect(span.events).toHaveLength(0);
    });
});
