import type { Span } from '@flareapp/core';
import { describe, expect, it, vi } from 'vitest';

import { IdleRootController, type IdleRootDeps, type IdleTimeouts } from '../src/tracing/IdleRootController';

const TIMEOUTS: IdleTimeouts = { idleTimeout: 1000, finalTimeout: 30000, childSpanTimeout: 15000 };

function fakeSpan(id: string, traceId: string, endTime = 0): Span {
    return {
        traceId,
        spanId: id,
        parentSpanId: null,
        name: id,
        isRecording: true,
        endTimeUnixNano: endTime,
        setAttribute() {
            return this;
        },
        setStatus() {
            return this;
        },
        addEvent() {
            return this;
        },
        end: vi.fn(),
    } as unknown as Span;
}

// Controllable harness: manual timers keyed by id (deadline in nanos), manual clock, manual listener.
function harness(root: Span) {
    let listener: ((e: { phase: 'start' | 'end'; span: Span }) => void) | null = null;
    let clock = 0;
    const timers = new Map<number, { fn: () => void; at: number }>();
    let nextId = 1;
    const setActiveRoot = vi.fn();

    const deps: IdleRootDeps = {
        root,
        addSpanListener: (fn) => {
            listener = fn;
            return () => {
                listener = null;
            };
        },
        setActiveRoot,
        now: () => clock,
        setTimeout: (fn, ms) => {
            const id = nextId++;
            timers.set(id, { fn, at: clock + ms * 1e6 });
            return id as unknown as ReturnType<typeof setTimeout>;
        },
        clearTimeout: (h) => {
            timers.delete(h as unknown as number);
        },
        rootStartTime: 0,
    };

    return {
        deps,
        setActiveRoot,
        emit: (phase: 'start' | 'end', span: Span) => listener?.({ phase, span }),
        advance: (ms: number) => {
            clock += ms * 1e6;
            for (const [id, t] of timers) {
                if (t.at <= clock) {
                    timers.delete(id);
                    t.fn();
                }
            }
        },
        setClock: (ns: number) => {
            clock = ns;
        },
    };
}

describe('IdleRootController', () => {
    it('ends the root trimmed to the last child end after idleTimeout of no open children', () => {
        const root = fakeSpan('root', 'T');
        const h = harness(root);
        new IdleRootController(h.deps, TIMEOUTS);
        expect(h.setActiveRoot).toHaveBeenCalledWith(root);

        const child = fakeSpan('c1', 'T', 500 * 1e6);
        h.emit('start', child);
        h.emit('end', child);
        h.advance(1000);

        expect(root.end).toHaveBeenCalledWith(500 * 1e6);
        expect(h.setActiveRoot).toHaveBeenLastCalledWith(undefined);
    });

    it('a new child before idle fires cancels the pending close', () => {
        const root = fakeSpan('root', 'T');
        const h = harness(root);
        new IdleRootController(h.deps, TIMEOUTS);
        const c1 = fakeSpan('c1', 'T', 100 * 1e6);
        h.emit('start', c1);
        h.emit('end', c1);
        h.advance(500);
        const c2 = fakeSpan('c2', 'T');
        h.emit('start', c2);
        h.advance(1000);
        expect(root.end).not.toHaveBeenCalled();
    });

    it('finalTimeout hard-caps even with an open child', () => {
        const root = fakeSpan('root', 'T');
        const h = harness(root);
        new IdleRootController(h.deps, TIMEOUTS);
        h.emit('start', fakeSpan('c1', 'T'));
        h.advance(30000);
        expect(root.end).toHaveBeenCalledTimes(1);
    });

    it('childSpanTimeout force-ends with a stuck open child', () => {
        const root = fakeSpan('root', 'T');
        const h = harness(root);
        new IdleRootController(h.deps, TIMEOUTS);
        h.emit('start', fakeSpan('c1', 'T'));
        h.advance(15000);
        expect(root.end).toHaveBeenCalledTimes(1);
    });

    it('re-arms the child timeout on a second non-empty period', () => {
        const root = fakeSpan('root', 'T');
        const h = harness(root);
        new IdleRootController(h.deps, TIMEOUTS);

        // First batch: open then close a child (0->1->0), well under childSpanTimeout.
        const c1 = fakeSpan('c1', 'T', 200 * 1e6);
        h.emit('start', c1);
        h.emit('end', c1); // clears the first child timer, arms idle

        // Second batch starts before idle fires; a stuck child should force-end at
        // childSpanTimeout measured from THIS batch, proving a fresh timer was armed.
        h.advance(500); // < idleTimeout, so root still open
        h.emit('start', fakeSpan('c2', 'T')); // stays open, re-arms child timeout
        h.advance(15000);

        expect(root.end).toHaveBeenCalledTimes(1);
    });

    it('ignores spans from other traces and the root itself', () => {
        const root = fakeSpan('root', 'T');
        const h = harness(root);
        new IdleRootController(h.deps, TIMEOUTS);
        h.emit('start', fakeSpan('other', 'OTHER'));
        h.emit('start', root);
        h.advance(1000);
        expect(root.end).toHaveBeenCalledTimes(1);
    });

    it('endNow ends immediately and is idempotent', () => {
        const root = fakeSpan('root', 'T');
        const h = harness(root);
        h.setClock(42);
        const c = new IdleRootController(h.deps, TIMEOUTS);
        c.endNow();
        c.endNow();
        expect(root.end).toHaveBeenCalledTimes(1);
        expect(root.end).toHaveBeenCalledWith(42);
        expect(c.isEnded).toBe(true);
    });
});
