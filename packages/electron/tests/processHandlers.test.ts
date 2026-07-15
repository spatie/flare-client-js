import { describe, expect, it, vi } from 'vitest';

import { buildFatalCallbacks } from '../src/main/processHandlers';

describe('buildFatalCallbacks', () => {
    it('report-and-exit: reports, flushes, then calls injected exit(1)', async () => {
        const reporter = { report: vi.fn().mockResolvedValue(undefined), flush: vi.fn() };
        const exit = vi.fn();
        const cbs = buildFatalCallbacks(
            reporter as any,
            () => ({
                uncaughtExceptionMode: 'report-and-exit',
                unhandledRejectionMode: 'report-and-exit',
                shutdownTimeoutMs: 50,
            }),
            exit,
        );
        await cbs.onUncaught(new Error('boom'), 'uncaughtException');
        expect(reporter.report).toHaveBeenCalledTimes(1);
        expect(reporter.flush).toHaveBeenCalledWith(50);
        expect(exit).toHaveBeenCalledWith(1);
        // flush must complete before exit is called
        expect(reporter.flush.mock.invocationCallOrder[0]).toBeLessThan(exit.mock.invocationCallOrder[0]);
    });

    it('report mode: reports but does NOT exit or flush', async () => {
        const reporter = { report: vi.fn().mockResolvedValue(undefined), flush: vi.fn() };
        const exit = vi.fn();
        const cbs = buildFatalCallbacks(
            reporter as any,
            () => ({ uncaughtExceptionMode: 'report', unhandledRejectionMode: 'report', shutdownTimeoutMs: 50 }),
            exit,
        );
        await cbs.onRejection(new Error('rej'));
        expect(reporter.report).toHaveBeenCalledTimes(1);
        expect(reporter.flush).not.toHaveBeenCalled();
        expect(exit).not.toHaveBeenCalled();
    });
});
