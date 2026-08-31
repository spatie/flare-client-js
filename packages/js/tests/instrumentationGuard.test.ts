import { describe, expect, it, vi } from 'vitest';

import { insulate, instrumentOnce, safeInvoke } from '../src/tracing/utils';

describe('insulate', () => {
    it('forwards args to the wrapped fn', () => {
        const fn = vi.fn();
        insulate(fn)('a', 1);
        expect(fn).toHaveBeenCalledWith('a', 1);
    });

    it('swallows a throw and returns undefined', () => {
        const wrapped = insulate(() => {
            throw new Error('boom');
        });
        expect(wrapped()).toBeUndefined();
        expect(() => wrapped()).not.toThrow();
    });
});

describe('safeInvoke', () => {
    it('invokes the fn', () => {
        const fn = vi.fn();
        safeInvoke(fn);
        expect(fn).toHaveBeenCalledOnce();
    });

    it('tolerates null / undefined', () => {
        expect(() => safeInvoke(null)).not.toThrow();
        expect(() => safeInvoke(undefined)).not.toThrow();
    });

    it('swallows a throw', () => {
        expect(() =>
            safeInvoke(() => {
                throw new Error('boom');
            }),
        ).not.toThrow();
    });
});

describe('instrumentOnce', () => {
    it('runs every tracked teardown on cleanup, and tolerates one that was never produced', () => {
        const first = vi.fn();
        const second = vi.fn();
        const cleanup = instrumentOnce({}, (track) => {
            track(first);
            track(undefined); // a listener the install chose to skip
            track(second);
        });

        cleanup();

        expect(first).toHaveBeenCalledOnce();
        expect(second).toHaveBeenCalledOnce();
    });

    it('tears down the prior instrumentation of the same target before installing again', () => {
        const target = {};
        const firstTeardown = vi.fn();
        instrumentOnce(target, (track) => track(firstTeardown));

        instrumentOnce(target, () => {});

        expect(firstTeardown).toHaveBeenCalledOnce();
    });

    // install() runs during the host's bootstrap. A throw from router subscribe/on/guard registration
    // must not reach it, and any already-registered listeners must not stay attached.
    it('unwinds a failed install newest first and swallows the throw', () => {
        const order: string[] = [];
        let cleanup: (() => void) | undefined;

        expect(() => {
            cleanup = instrumentOnce({}, (track) => {
                track(() => order.push('first'));
                track(() => order.push('second'));
                throw new Error('subscribe boom');
            });
        }).not.toThrow();

        expect(order).toEqual(['second', 'first']);
        // Already unwound, so the returned cleanup must not run the teardowns a second time.
        cleanup?.();
        expect(order).toEqual(['second', 'first']);
    });

    it('leaves a target whose install failed instrumentable again', () => {
        const target = {};
        const leaked = vi.fn();
        instrumentOnce(target, (track) => {
            track(leaked);
            throw new Error('subscribe boom');
        });
        leaked.mockClear(); // it already unwound; this asserts the retry does not re-run it

        instrumentOnce(target, () => {});

        expect(leaked).not.toHaveBeenCalled();
    });

    it('keeps unwinding past a teardown that throws', () => {
        const last = vi.fn();
        const cleanup = instrumentOnce({}, (track) => {
            track(last);
            track(() => {
                throw new Error('teardown boom');
            });
        });

        expect(() => cleanup()).not.toThrow();
        expect(last).toHaveBeenCalledOnce();
    });
});
