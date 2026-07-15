import { describe, expect, it, vi } from 'vitest';

import { insulate, safeInvoke } from '../src/tracing/instrumentationGuard';

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
