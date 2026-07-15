import { afterEach, describe, expect, it, vi } from 'vitest';

import { installGlobalErrorHandler } from '../src/handlers/globalErrorHandler';
import { stubErrorUtils } from './helpers/stubErrorUtils';

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

describe('installGlobalErrorHandler — fatal flush-before-delegate', () => {
    afterEach(() => {
        delete (globalThis as Record<string, unknown>).__DEV__;
    });

    it('defers the previous handler on a production fatal until onFatal settles', async () => {
        const prev = vi.fn();
        const ctl = stubErrorUtils(prev);
        const report = vi.fn();

        let resolveFlush: (() => void) | undefined;
        const onFatal = vi.fn(
            () =>
                new Promise<void>((r) => {
                    resolveFlush = r;
                }),
        );

        installGlobalErrorHandler(report, onFatal);
        ctl.emit(new Error('fatal'), true);

        expect(report).toHaveBeenCalledTimes(1);
        expect(onFatal).toHaveBeenCalledTimes(1);
        // Crash deferred: the previous (crash-triggering) handler is NOT called
        // while the flush is in flight.
        expect(prev).not.toHaveBeenCalled();

        resolveFlush?.();
        await vi.waitFor(() => expect(prev).toHaveBeenCalledTimes(1));
    });

    it('still delegates to the previous handler if onFatal rejects', async () => {
        const prev = vi.fn();
        const ctl = stubErrorUtils(prev);
        const onFatal = vi.fn(() => Promise.reject(new Error('flush failed')));

        installGlobalErrorHandler(vi.fn(), onFatal);
        ctl.emit(new Error('fatal'), true);

        await vi.waitFor(() => expect(prev).toHaveBeenCalledTimes(1));
    });

    it('does not defer or flush in __DEV__ (delegates immediately)', () => {
        (globalThis as Record<string, unknown>).__DEV__ = true;
        const prev = vi.fn();
        const ctl = stubErrorUtils(prev);
        const onFatal = vi.fn(() => Promise.resolve());

        installGlobalErrorHandler(vi.fn(), onFatal);
        ctl.emit(new Error('fatal'), true);

        expect(onFatal).not.toHaveBeenCalled();
        expect(prev).toHaveBeenCalledTimes(1);
    });

    it('does not flush on a non-fatal error', () => {
        const prev = vi.fn();
        const ctl = stubErrorUtils(prev);
        const onFatal = vi.fn(() => Promise.resolve());

        installGlobalErrorHandler(vi.fn(), onFatal);
        ctl.emit(new Error('recoverable'), false);

        expect(onFatal).not.toHaveBeenCalled();
        expect(prev).toHaveBeenCalledTimes(1);
    });

    it('re-entrancy: a second fatal mid-flush delegates immediately (single flush)', async () => {
        const prev = vi.fn();
        const ctl = stubErrorUtils(prev);
        let resolveFlush: (() => void) | undefined;
        const onFatal = vi.fn(
            () =>
                new Promise<void>((r) => {
                    resolveFlush = r;
                }),
        );

        installGlobalErrorHandler(vi.fn(), onFatal);
        ctl.emit(new Error('fatal-1'), true); // starts the flush, defers prev
        ctl.emit(new Error('fatal-2'), true); // latched -> delegates immediately

        expect(onFatal).toHaveBeenCalledTimes(1);
        expect(prev).toHaveBeenCalledTimes(1);

        resolveFlush?.();
        await vi.waitFor(() => expect(prev).toHaveBeenCalledTimes(2));
    });
});
