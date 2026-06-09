import { describe, expect, it, vi } from 'vitest';

import { buildFatalCallbacks } from '../src/main/processHandlers';

function fakeFlare() {
    return {
        report: vi.fn().mockResolvedValue(undefined),
        flush: vi.fn().mockResolvedValue(undefined),
    };
}

describe('buildFatalCallbacks', () => {
    it('report-and-exit: reports, flushes, then calls injected exit(1)', async () => {
        const flare = fakeFlare();
        const exit = vi.fn();
        const cbs = buildFatalCallbacks(
            flare as any,
            () => ({
                uncaughtExceptionMode: 'report-and-exit',
                unhandledRejectionMode: 'report-and-exit',
                shutdownTimeoutMs: 50,
            }),
            exit,
        );
        await cbs.onUncaught(new Error('boom'), 'uncaughtException');
        expect(flare.report).toHaveBeenCalledTimes(1);
        expect(flare.flush).toHaveBeenCalledWith(50);
        expect(exit).toHaveBeenCalledWith(1);
    });

    it('report mode: reports but does NOT exit or flush', async () => {
        const flare = fakeFlare();
        const exit = vi.fn();
        const cbs = buildFatalCallbacks(
            flare as any,
            () => ({ uncaughtExceptionMode: 'report', unhandledRejectionMode: 'report', shutdownTimeoutMs: 50 }),
            exit,
        );
        await cbs.onRejection(new Error('rej'));
        expect(flare.report).toHaveBeenCalledTimes(1);
        expect(flare.flush).not.toHaveBeenCalled();
        expect(exit).not.toHaveBeenCalled();
    });
});
