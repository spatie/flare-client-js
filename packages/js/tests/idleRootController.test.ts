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
function harness(root: Span, endFloor: () => number = () => 0) {
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
        endFloor,
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
        const controller = new IdleRootController(h.deps, TIMEOUTS);
        expect(controller.isEnded).toBe(false);
        expect(h.setActiveRoot).toHaveBeenCalledWith(root);

        const child = fakeSpan('c1', 'T', 500 * 1e6);
        h.emit('start', child);
        h.emit('end', child);
        h.advance(1000);

        expect(root.end).toHaveBeenCalledWith(500 * 1e6);
        expect(h.setActiveRoot).toHaveBeenLastCalledWith(undefined);
    });

    it('a childless root ends at the end floor, not padded to now() (the idle-padding bug)', () => {
        // A pageload whose window had no fetch/xhr children must close at its real
        // load-event floor (here 700ms), NOT at start + idleTimeout (1000ms).
        const root = fakeSpan('root', 'T');
        const h = harness(root, () => 700 * 1e6);
        const controller = new IdleRootController(h.deps, TIMEOUTS);
        expect(controller.isEnded).toBe(false);
        h.advance(1000); // idleTimeout elapses with no child ever started
        expect(root.end).toHaveBeenCalledWith(700 * 1e6);
    });

    it('a childless navigation-style root (floor = start) trims to ~zero, not idleTimeout', () => {
        const root = fakeSpan('root', 'T');
        const h = harness(root, () => 0); // navigation floor is the root start
        const controller = new IdleRootController(h.deps, TIMEOUTS);
        expect(controller.isEnded).toBe(false);
        h.advance(1000);
        expect(root.end).toHaveBeenCalledWith(0);
    });

    it('a new child before idle fires cancels the pending close', () => {
        const root = fakeSpan('root', 'T');
        const h = harness(root);
        const controller = new IdleRootController(h.deps, TIMEOUTS);
        expect(controller.isEnded).toBe(false);
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
        const controller = new IdleRootController(h.deps, TIMEOUTS);
        expect(controller.isEnded).toBe(false);
        h.emit('start', fakeSpan('c1', 'T'));
        h.advance(30000);
        expect(root.end).toHaveBeenCalledTimes(1);
    });

    it('childSpanTimeout force-ends with a stuck open child', () => {
        const root = fakeSpan('root', 'T');
        const h = harness(root);
        const controller = new IdleRootController(h.deps, TIMEOUTS);
        expect(controller.isEnded).toBe(false);
        h.emit('start', fakeSpan('c1', 'T'));
        h.advance(15000);
        expect(root.end).toHaveBeenCalledTimes(1);
    });

    it('re-arms the child timeout on a second non-empty period', () => {
        const root = fakeSpan('root', 'T');
        const h = harness(root);
        const controller = new IdleRootController(h.deps, TIMEOUTS);
        expect(controller.isEnded).toBe(false);

        // First batch: open then close a child (0->1->0), well under childSpanTimeout.
        const c1 = fakeSpan('c1', 'T', 200 * 1e6);
        h.emit('start', c1);
        h.emit('end', c1); // clears the first child timer, arms idle

        // Second batch starts before idle fires; a stuck child should force-end at
        // childSpanTimeout measured from this batch, proving a fresh timer was armed.
        h.advance(500); // < idleTimeout, so root still open
        h.emit('start', fakeSpan('c2', 'T')); // stays open, re-arms child timeout
        h.advance(15000);

        expect(root.end).toHaveBeenCalledTimes(1);
    });

    it('ignores spans from other traces and the root itself', () => {
        const root = fakeSpan('root', 'T');
        const h = harness(root);
        const controller = new IdleRootController(h.deps, TIMEOUTS);
        expect(controller.isEnded).toBe(false);
        h.emit('start', fakeSpan('other', 'OTHER'));
        h.emit('start', root);
        h.advance(1000);
        expect(root.end).toHaveBeenCalledTimes(1);
    });

    it('endNow with no open children ends at the floor (not now()) and is idempotent', () => {
        // Force-ended (route change / pagehide) while idle: trim to the floor, don't
        // pad to the moment of the force-end.
        const root = fakeSpan('root', 'T');
        const h = harness(root, () => 300 * 1e6);
        h.setClock(42 * 1e6);
        const c = new IdleRootController(h.deps, TIMEOUTS);
        c.endNow();
        c.endNow();
        expect(root.end).toHaveBeenCalledTimes(1);
        expect(root.end).toHaveBeenCalledWith(300 * 1e6);
        expect(c.isEnded).toBe(true);
    });

    it('endNow with an open child ends at now() (in-flight work is not cut short)', () => {
        const root = fakeSpan('root', 'T');
        const h = harness(root, () => 0);
        const c = new IdleRootController(h.deps, TIMEOUTS);
        h.emit('start', fakeSpan('c1', 'T')); // child still in flight
        h.setClock(900 * 1e6);
        c.endNow();
        expect(root.end).toHaveBeenCalledWith(900 * 1e6);
    });

    it('held root does not idle-close until the hold is released', () => {
        const root = fakeSpan('root', 'T');
        const h = harness(root);
        const controller = new IdleRootController({ ...h.deps, held: true }, TIMEOUTS);
        h.advance(1000); // idleTimeout would normally close it
        expect(root.end).not.toHaveBeenCalled();
        expect(controller.isEnded).toBe(false);
    });

    it('releaseHold closes a childless root at now(), capturing the held duration', () => {
        const root = fakeSpan('root', 'T');
        const h = harness(root, () => 0); // start floor 0
        const controller = new IdleRootController({ ...h.deps, held: true }, TIMEOUTS);
        h.setClock(5000 * 1e6); // 5s of loader time elapsed
        controller.releaseHold();
        expect(root.end).toHaveBeenCalledWith(5000 * 1e6); // settle time, NOT trimmed to floor 0
        expect(controller.isEnded).toBe(true);
    });

    it('held root survives idleTimeout after a child starts and ends during the hold', () => {
        // The loader-navigation flow: the loader's fetch child opens and closes while the root is
        // held. The child-end path re-arms idle, but the hold must keep suppressing it so the root
        // stays open until the router settles and releaseHold() closes it at settle time.
        const root = fakeSpan('root', 'T');
        const h = harness(root, () => 0);
        const controller = new IdleRootController({ ...h.deps, held: true }, TIMEOUTS);
        const child = fakeSpan('c1', 'T', 2000 * 1e6);
        h.emit('start', child);
        h.emit('end', child);
        h.advance(1000); // idleTimeout elapses with no open children; a held root must not close
        expect(root.end).not.toHaveBeenCalled();
        expect(controller.isEnded).toBe(false);
        h.setClock(5000 * 1e6);
        controller.releaseHold(); // childless at settle -> close at now(), spanning the loader window
        expect(root.end).toHaveBeenCalledWith(5000 * 1e6);
        expect(controller.isEnded).toBe(true);
    });

    it('releaseHold with an open child hands back to the idle lifecycle', () => {
        const root = fakeSpan('root', 'T');
        const h = harness(root, () => 0);
        const controller = new IdleRootController({ ...h.deps, held: true }, TIMEOUTS);
        const child = fakeSpan('c1', 'T', 2000 * 1e6);
        h.emit('start', child);
        controller.releaseHold(); // not childless -> re-arm idle, do not close now
        expect(root.end).not.toHaveBeenCalled();
        h.emit('end', child);
        h.advance(1000); // idle closes, trimmed to the child's end
        expect(root.end).toHaveBeenCalledWith(2000 * 1e6);
    });

    it('releaseHold is a no-op when the root was never held', () => {
        const root = fakeSpan('root', 'T');
        const h = harness(root);
        const controller = new IdleRootController(h.deps, TIMEOUTS);
        controller.releaseHold();
        expect(root.end).not.toHaveBeenCalled();
        expect(controller.isEnded).toBe(false);
    });

    it('finalTimeout still force-closes a held root that never settles', () => {
        const root = fakeSpan('root', 'T');
        const h = harness(root);
        const controller = new IdleRootController({ ...h.deps, held: true }, TIMEOUTS);
        h.advance(30000); // finalTimeout
        expect(root.end).toHaveBeenCalled();
        expect(controller.isEnded).toBe(true);
    });
});
