import { describe, expect, it, vi, beforeEach } from 'vitest';

import { FLARE_IPC_CHANNEL } from '../src/constants';
import { defaultTrustPolicy, registerIpcReceiver, disposeIpcReceiver } from '../src/main/ipcReceiver';
import { DEFAULT_ELECTRON_OPTIONS } from '../src/types';

function fakeIpcMain() {
    const handlers: Record<string, Function> = {};
    return {
        handlers,
        handle: vi.fn((channel: string, fn: Function) => {
            if (handlers[channel]) throw new Error('Attempted to register a second handler');
            handlers[channel] = fn;
        }),
        removeHandler: vi.fn((channel: string) => {
            delete handlers[channel];
        }),
    };
}

function validReportJson() {
    return JSON.stringify({ seenAtUnixNano: 1, stacktrace: [], events: [], attributes: {} });
}

describe('defaultTrustPolicy', () => {
    const opts = { ...DEFAULT_ELECTRON_OPTIONS };
    it('accepts file: and localhost, rejects remote and custom protocol', () => {
        expect(defaultTrustPolicy({ url: 'file:///app/index.html' }, opts)).toBe(true);
        expect(defaultTrustPolicy({ url: 'http://localhost:5180/' }, opts)).toBe(true);
        expect(defaultTrustPolicy({ url: 'http://127.0.0.1:5180/' }, opts)).toBe(true);
        expect(defaultTrustPolicy({ url: 'https://evil.example.com/' }, opts)).toBe(false);
        expect(defaultTrustPolicy({ url: 'app://index.html' }, opts)).toBe(false);
    });
    it('accepts a configured custom protocol', () => {
        expect(defaultTrustPolicy({ url: 'app://index.html' }, { ...opts, trustedProtocols: ['app'] })).toBe(true);
    });
});

describe('ipc receiver', () => {
    let owner: any;
    beforeEach(() => {
        owner = { id: 'A' };
    });

    it('rejects unknown sender, oversized, and malformed; accepts valid', async () => {
        const ipcMain = fakeIpcMain();
        const sent: any[] = [];
        const deps = {
            getOptions: () => ({ ...DEFAULT_ELECTRON_OPTIONS }),
            onReport: (r: any) => {
                sent.push(r);
                return Promise.resolve();
            },
        };
        registerIpcReceiver(ipcMain as any, owner, deps);
        const handler = ipcMain.handlers[FLARE_IPC_CHANNEL];

        await handler({ senderFrame: { url: 'https://evil.example.com' } }, validReportJson());
        expect(sent.length).toBe(0);

        const big = 'x'.repeat(DEFAULT_ELECTRON_OPTIONS.maxReportBytes + 1);
        await handler({ senderFrame: { url: 'file:///a.html' } }, big);
        expect(sent.length).toBe(0);

        await handler({ senderFrame: { url: 'file:///a.html' } }, JSON.stringify({ nope: true }));
        expect(sent.length).toBe(0);

        await handler({ senderFrame: { url: 'file:///a.html' } }, validReportJson());
        expect(sent.length).toBe(1);
        expect(sent[0].seenAtUnixNano).toBe(1);
    });

    it('ownership: a second owner takes over; old owner dispose is a no-op', () => {
        const ipcMain = fakeIpcMain();
        const deps = { getOptions: () => ({ ...DEFAULT_ELECTRON_OPTIONS }), onReport: () => Promise.resolve() };
        const a = { id: 'A' };
        const b = { id: 'B' };
        registerIpcReceiver(ipcMain as any, a, deps);
        ipcMain.removeHandler.mockClear();
        registerIpcReceiver(ipcMain as any, b, deps); // takeover
        expect(ipcMain.removeHandler).toHaveBeenCalledTimes(1);
        expect(ipcMain.handlers[FLARE_IPC_CHANNEL]).toBeDefined();

        disposeIpcReceiver(ipcMain as any, a); // old owner, no-op
        expect(ipcMain.handlers[FLARE_IPC_CHANNEL]).toBeDefined();

        disposeIpcReceiver(ipcMain as any, b); // current owner removes
        expect(ipcMain.handlers[FLARE_IPC_CHANNEL]).toBeUndefined();
    });
});
