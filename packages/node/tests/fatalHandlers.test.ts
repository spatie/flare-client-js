import { Flare, Api } from '@flareapp/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildFatalCallbacks } from '../src/process/fatal';

function fakeFlare(): { flare: Flare; sent: any[] } {
    const sent: any[] = [];
    const api = new Api();
    api.report = (report: any) => {
        sent.push(report);
        return Promise.resolve();
    };
    const flare = new Flare(api);
    flare.light('k');
    return { flare, sent };
}

afterEach(() => {
    // Reset exitCode so one test doesn't bleed into the next
    process.exitCode = undefined;
});

describe('fatal callbacks', () => {
    it('uncaught: awaits full report pipeline before resolving', async () => {
        const { flare, sent } = fakeFlare();
        const exit = vi.fn();
        const { onUncaught } = buildFatalCallbacks(
            flare,
            () => ({
                uncaughtExceptionMode: 'report-and-exit',
                unhandledRejectionMode: 'off',
                shutdownTimeoutMs: 1000,
            }),
            exit,
        );
        await onUncaught(new Error('boom'), 'uncaughtException');
        expect(sent.length).toBe(1);
        expect(sent[0].attributes['process.uncaught_exception.origin']).toBe('uncaughtException');
        expect(exit).toHaveBeenCalledWith(1);
    });

    it('uncaught: does NOT exit when mode is report', async () => {
        const { flare, sent } = fakeFlare();
        const exit = vi.fn();
        const { onUncaught } = buildFatalCallbacks(
            flare,
            () => ({
                uncaughtExceptionMode: 'report',
                unhandledRejectionMode: 'off',
                shutdownTimeoutMs: 1000,
            }),
            exit,
        );
        await onUncaught(new Error('boom'), 'uncaughtException');
        expect(sent.length).toBe(1);
        expect(exit).not.toHaveBeenCalled();
    });

    it('unhandled rejection: coerces non-Error reason', async () => {
        const { flare, sent } = fakeFlare();
        const exit = vi.fn();
        const { onRejection } = buildFatalCallbacks(
            flare,
            () => ({
                uncaughtExceptionMode: 'off',
                unhandledRejectionMode: 'report',
                shutdownTimeoutMs: 1000,
            }),
            exit,
        );
        await onRejection('a string reason');
        expect(sent.length).toBe(1);
        expect(sent[0].message).toBe('a string reason');
        expect(exit).not.toHaveBeenCalled();
    });

    it('uncaught: sets process.exitCode=1 synchronously before awaiting report', async () => {
        const { flare } = fakeFlare();
        let exitCodeDuringReport: number | string | undefined;
        const api = new Api();
        api.report = () => {
            exitCodeDuringReport = process.exitCode;
            return Promise.resolve();
        };
        flare.api = api;

        const exit = vi.fn();
        const { onUncaught } = buildFatalCallbacks(
            flare,
            () => ({
                uncaughtExceptionMode: 'report-and-exit',
                unhandledRejectionMode: 'off',
                shutdownTimeoutMs: 1000,
            }),
            exit,
        );
        await onUncaught(new Error('boom'), 'uncaughtException');
        expect(exitCodeDuringReport).toBe(1);
    });

    it('rejection: sets process.exitCode=1 synchronously before awaiting report', async () => {
        const { flare } = fakeFlare();
        let exitCodeDuringReport: number | string | undefined;
        const api = new Api();
        api.report = () => {
            exitCodeDuringReport = process.exitCode;
            return Promise.resolve();
        };
        flare.api = api;

        const exit = vi.fn();
        const { onRejection } = buildFatalCallbacks(
            flare,
            () => ({
                uncaughtExceptionMode: 'off',
                unhandledRejectionMode: 'report-and-exit',
                shutdownTimeoutMs: 1000,
            }),
            exit,
        );
        await onRejection(new Error('rejected'));
        expect(exitCodeDuringReport).toBe(1);
    });

    it('uncaught: does NOT set process.exitCode when mode is report', async () => {
        const { flare } = fakeFlare();
        const exit = vi.fn();
        const { onUncaught } = buildFatalCallbacks(
            flare,
            () => ({
                uncaughtExceptionMode: 'report',
                unhandledRejectionMode: 'off',
                shutdownTimeoutMs: 1000,
            }),
            exit,
        );
        await onUncaught(new Error('boom'), 'uncaughtException');
        expect(process.exitCode).toBeUndefined();
    });
});
