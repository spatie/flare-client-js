import { Flare, Api } from '@flareapp/core';
import { describe, expect, it, vi } from 'vitest';

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
});
