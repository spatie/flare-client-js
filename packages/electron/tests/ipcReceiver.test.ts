import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { FLARE_IPC_CHANNEL } from '../src/constants';
import { defaultTrustPolicy, registerIpcReceiver, disposeIpcReceiver } from '../src/main/ipcReceiver';
import { DEFAULT_ELECTRON_OPTIONS } from '../src/types';
import { fakeIpcMain } from './helpers';

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
    it('accepts IPv6 loopback and rejects file: with a foreign host', () => {
        expect(defaultTrustPolicy({ url: 'http://[::1]:5180/' }, opts)).toBe(true);
        expect(defaultTrustPolicy({ url: 'file:///app/index.html' }, opts)).toBe(true);
        expect(defaultTrustPolicy({ url: 'file://evil.com/app/index.html' }, opts)).toBe(false);
    });
});

describe('ipc receiver', () => {
    let owner: any;
    let ipcMain: ReturnType<typeof fakeIpcMain>;
    beforeEach(() => {
        owner = { id: 'A' };
        ipcMain = fakeIpcMain();
    });
    afterEach(() => {
        // Dispose the current test's owner so module-level currentOwner is reset between tests.
        disposeIpcReceiver(ipcMain as any, owner);
    });

    it('rejects unknown sender, oversized, and malformed; accepts valid', async () => {
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
        // Update shared owner to b so afterEach's dispose call is a no-op (b already disposed).
        owner = b;
    });
});
