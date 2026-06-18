import { afterEach, describe, expect, it, vi } from 'vitest';

import { installGlobalErrorHandler } from '../src/handlers/globalErrorHandler';

type Handler = (error: unknown, isFatal?: boolean) => void;

// Stub RN's `ErrorUtils` global, optionally seeded with an initial handler.
// Returns `emit` (fire the currently-registered handler) and `current` (read it).
function stubErrorUtils(initial?: Handler) {
    let current: Handler | undefined = initial;
    (globalThis as Record<string, unknown>).ErrorUtils = {
        getGlobalHandler: () => current,
        setGlobalHandler: (cb: Handler) => {
            current = cb;
        },
    };
    return {
        emit: (error: unknown, isFatal?: boolean) => current?.(error, isFatal),
        current: () => current,
    };
}

afterEach(() => {
    delete (globalThis as Record<string, unknown>).ErrorUtils;
});

describe('installGlobalErrorHandler', () => {
    it('reports the error and chains the previous handler', () => {
        const prev = vi.fn();
        const ctl = stubErrorUtils(prev);

        const report = vi.fn();
        installGlobalErrorHandler(report);

        const boom = new Error('boom');
        ctl.emit(boom, true);

        expect(report).toHaveBeenCalledTimes(1);
        expect(report.mock.calls[0][0]).toBeInstanceOf(Error);
        expect((report.mock.calls[0][0] as Error).message).toBe('boom');
        expect(report.mock.calls[0][1]).toBe(true);
        expect(prev).toHaveBeenCalledTimes(1);
    });

    it('uninstall restores the previous handler', () => {
        const prev = vi.fn();
        const ctl = stubErrorUtils(prev);

        const report = vi.fn();
        const uninstall = installGlobalErrorHandler(report);
        uninstall();

        ctl.current()?.(new Error('x'));
        expect(report).not.toHaveBeenCalled();
        expect(prev).toHaveBeenCalledTimes(1);
    });

    it('is a no-op when ErrorUtils is absent', () => {
        const report = vi.fn();
        const uninstall = installGlobalErrorHandler(report);
        expect(() => uninstall()).not.toThrow();
        expect(report).not.toHaveBeenCalled();
    });
});
