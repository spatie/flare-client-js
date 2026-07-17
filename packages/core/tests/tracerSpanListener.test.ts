import { describe, expect, it } from 'vitest';

import { config, makeTracer } from './helpers/makeTracer';

describe('Tracer span listener + active root', () => {
    it('emits start on startSpan and end on span end; unsubscribe stops delivery', () => {
        const tracer = makeTracer(config());
        const events: Array<{ phase: string; spanId: string }> = [];
        const off = tracer.addSpanListener((e) => events.push({ phase: e.phase, spanId: e.span.spanId }));

        const span = tracer.startSpan('op');
        span.end();

        expect(events.map((e) => e.phase)).toEqual(['start', 'end']);
        expect(events[0].spanId).toBe(span.spanId);

        off();
        tracer.startSpan('op2').end();
        expect(events).toHaveLength(2); // no new events after unsubscribe
    });

    it('a throwing listener does not break span creation or ending', () => {
        const tracer = makeTracer(config());
        tracer.addSpanListener(() => {
            throw new Error('listener boom');
        });
        expect(() => tracer.startSpan('op').end()).not.toThrow();
    });

    it('setActiveRoot makes getActiveSpan return the root, and clearing returns undefined', () => {
        const tracer = makeTracer(config());
        const root = tracer.startSpan('root');
        tracer.setActiveRoot(root);
        expect(tracer.getActiveSpan()).toBe(root);
        tracer.setActiveRoot(undefined);
        expect(tracer.getActiveSpan()).toBeUndefined();
    });
});
