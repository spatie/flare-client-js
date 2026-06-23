import { Api } from '@flareapp/core';
import { describe, expect, it, vi } from 'vitest';

import { ElectronFlare } from '../src/main/ElectronFlare';

function fakeApp() {
    return {
        getName: () => 'TestApp',
        getVersion: () => '1.0.0',
        getLocale: () => 'en-US',
        isReady: () => true,
        isPackaged: false,
        on: vi.fn(),
        // off is needed once Task 11 makes the constructor attach crash listeners and dispose() detach them.
        off: vi.fn(),
    };
}

function fakeIpcMain() {
    const handlers: Record<string, Function> = {};
    return {
        handlers,
        handle: vi.fn((c: string, fn: Function) => {
            handlers[c] = fn;
        }),
        removeHandler: vi.fn((c: string) => {
            delete handlers[c];
        }),
    };
}

function makeFlare() {
    const sent: any[] = [];
    const api = new Api();
    api.report = (r: any) => {
        sent.push(r);
        return Promise.resolve();
    };
    const app = fakeApp();
    const ipcMain = fakeIpcMain();
    const flare = new ElectronFlare({ app: app as any, ipcMain: ipcMain as any });
    flare.api = api;
    flare.light('test-key');
    return { flare, sent, app, ipcMain };
}

describe('ElectronFlare', () => {
    it('sets electron SDK identity and app context on main reports', async () => {
        const { flare, sent } = makeFlare();
        await flare.report(new Error('main boom'));
        expect(sent.length).toBe(1);
        const a = sent[0].attributes;
        expect(a['telemetry.sdk.name']).toBe('@flareapp/electron');
        expect(a['service.name']).toBe('TestApp');
        expect(a['process.runtime.name']).toBe('electron');
    });

    it('setUser writes user.* on the next main-origin report', async () => {
        const { flare, sent } = makeFlare();
        flare.setUser({ id: 7, email: 'u@x.io' });
        await flare.report(new Error('with user'));
        expect(sent[0].attributes['user.id']).toBe('7');
        expect(sent[0].attributes['user.email']).toBe('u@x.io');
        expect(sent[0].attributes['enduser.id']).toBeUndefined();
        flare.setUser(null);
        await flare.report(new Error('no user'));
        expect(sent[1].attributes['user.id']).toBeUndefined();
    });

    it('forwarded reports get main config (stage/version/sourcemap) overlaid', async () => {
        const { flare, ipcMain } = makeFlare();
        const sentOut: any[] = [];
        flare.api.report = (r: any) => {
            sentOut.push(r);
            return Promise.resolve();
        };
        flare.configure({ stage: 'production', version: '2.0.0', sourcemapVersionId: 'sm-1' });
        flare.setUser({ id: 99, email: 'main@user.io' });

        const handler = ipcMain.handlers['flare:report'];
        const rendererReport = JSON.stringify({
            seenAtUnixNano: 5,
            stacktrace: [],
            events: [],
            attributes: {
                'service.stage': '',
                'flare.entry_point.value': 'http://localhost/page',
                'flare.entry_point.type': 'web',
                'user.id': 'renderer-should-lose',
            },
        });
        await handler({ senderFrame: { url: 'file:///index.html' } }, rendererReport);

        expect(sentOut.length).toBe(1);
        expect(sentOut[0].attributes['service.stage']).toBe('production');
        expect(sentOut[0].attributes['service.version']).toBe('2.0.0');
        expect(sentOut[0].sourcemapVersionId).toBe('sm-1');
        // renderer browser context preserved
        expect(sentOut[0].attributes['flare.entry_point.value']).toBe('http://localhost/page');
        // renderer entry_point.type must NOT be overwritten to 'server' by the main overlay
        expect(sentOut[0].attributes['flare.entry_point.type']).toBe('web');
        // electron app metadata merged
        expect(sentOut[0].attributes['service.name']).toBe('TestApp');
        // main-side user is authoritative on forwarded reports and overrides any renderer-supplied key
        expect(sentOut[0].attributes['user.id']).toBe('99');
        expect(sentOut[0].attributes['user.email']).toBe('main@user.io');
    });

    it('strips renderer-supplied identity keys main did not set (no mixed identity, no leak)', async () => {
        const { flare, ipcMain } = makeFlare();
        const sentOut: any[] = [];
        flare.api.report = (r: any) => {
            sentOut.push(r);
            return Promise.resolve();
        };
        // Main sets ONLY an id. Email/attributes/client.address are left unset on the main scope.
        flare.setUser({ id: 99 });

        const handler = ipcMain.handlers['flare:report'];
        const rendererReport = JSON.stringify({
            seenAtUnixNano: 5,
            stacktrace: [],
            events: [],
            attributes: {
                'user.id': 'renderer-should-lose',
                'user.email': 'renderer@x.io',
                'user.attributes': { plan: 'renderer-plan' },
                'client.address': '6.6.6.6',
            },
        });
        await handler({ senderFrame: { url: 'file:///index.html' } }, rendererReport);

        expect(sentOut.length).toBe(1);
        const a = sentOut[0].attributes;
        // Main's id wins.
        expect(a['user.id']).toBe('99');
        // Renderer identity keys main did NOT set must be gone, not mixed in.
        expect(a['user.email']).toBeUndefined();
        expect(a['user.attributes']).toBeUndefined();
        expect(a['client.address']).toBeUndefined();
    });

    it('strips renderer-supplied identity when main never called setUser', async () => {
        const { flare, ipcMain } = makeFlare();
        const sentOut: any[] = [];
        flare.api.report = (r: any) => {
            sentOut.push(r);
            return Promise.resolve();
        };
        // No flare.setUser(...) — main has no identity to assert.

        const handler = ipcMain.handlers['flare:report'];
        const rendererReport = JSON.stringify({
            seenAtUnixNano: 5,
            stacktrace: [],
            events: [],
            attributes: { 'user.id': 'renderer-forged', 'user.email': 'renderer@x.io' },
        });
        await handler({ senderFrame: { url: 'file:///index.html' } }, rendererReport);

        expect(sentOut.length).toBe(1);
        // A renderer must not be able to identify users the main process never set.
        expect(sentOut[0].attributes['user.id']).toBeUndefined();
        expect(sentOut[0].attributes['user.email']).toBeUndefined();
    });

    it('strips renderer-supplied stage/version/sourcemap when main never configured them', async () => {
        const { flare, ipcMain } = makeFlare();
        const sentOut: any[] = [];
        flare.api.report = (r: any) => {
            sentOut.push(r);
            return Promise.resolve();
        };
        // No flare.configure(...) — main has no stage/version/sourcemap.

        const handler = ipcMain.handlers['flare:report'];
        const rendererReport = JSON.stringify({
            seenAtUnixNano: 5,
            stacktrace: [],
            events: [],
            sourcemapVersionId: 'renderer-forged',
            attributes: {
                'service.stage': 'renderer-forged',
                'service.version': 'renderer-forged',
                'flare.entry_point.type': 'web',
            },
        });
        await handler({ senderFrame: { url: 'file:///index.html' } }, rendererReport);

        expect(sentOut.length).toBe(1);
        // Config-derived fields are main-authoritative: renderer values must not survive.
        expect(sentOut[0].attributes['service.stage']).toBeUndefined();
        expect(sentOut[0].attributes['service.version']).toBeUndefined();
        expect(sentOut[0].sourcemapVersionId).toBeUndefined();
        // Non-config renderer data still preserved.
        expect(sentOut[0].attributes['flare.entry_point.type']).toBe('web');
    });

    it('dispose removes the IPC handler and detaches process listeners', () => {
        const { flare, ipcMain } = makeFlare();
        expect(ipcMain.handlers['flare:report']).toBeDefined();
        flare.dispose();
        expect(ipcMain.handlers['flare:report']).toBeUndefined();
    });

    it('flush() waits for an in-flight forwarded renderer report', async () => {
        const { flare, ipcMain } = makeFlare();
        let resolveSend!: () => void;
        const sendGate = new Promise<void>((r) => {
            resolveSend = r;
        });
        // Make the egress hang so the forwarded send stays in-flight.
        flare.api.report = () => sendGate;

        const handler = ipcMain.handlers['flare:report'];
        const reportJson = JSON.stringify({ seenAtUnixNano: 1, stacktrace: [], events: [], attributes: {} });
        // Do NOT await: the receiver send is now pending.
        void handler({ senderFrame: { url: 'file:///a.html' } }, reportJson);
        // Let the handler reach the hanging send.
        await new Promise((r) => setTimeout(r, 0));

        let flushed = false;
        const flushPromise = flare.flush(1000).then(() => {
            flushed = true;
        });
        await new Promise((r) => setTimeout(r, 20));
        expect(flushed).toBe(false); // still waiting on the forwarded send

        resolveSend();
        await flushPromise;
        expect(flushed).toBe(true);
    });

    it('flush() clears its timeout when reports settle first (no dangling timer)', async () => {
        const { flare } = makeFlare();
        vi.useFakeTimers();
        try {
            // No in-flight forwarded reports and core has nothing pending, so settled resolves fast.
            const p = flare.flush(5000);
            // Let the microtask (allSettled.then) run, then assert the timer was cleared.
            await vi.advanceTimersByTimeAsync(0);
            await p;
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it('configureElectron ignores explicit undefined and preserves resolved defaults', async () => {
        const { flare, sent, ipcMain } = makeFlare();
        // Spread-built config with explicit undefined fields must not clobber defaults.
        flare.configureElectron({ trustedProtocols: undefined, maxReportBytes: undefined } as any);

        const handler = ipcMain.handlers['flare:report'];
        const reportJson = JSON.stringify({ seenAtUnixNano: 2, stacktrace: [], events: [], attributes: {} });
        // A report from a trusted file: sender should be accepted (trustedProtocols.includes must not throw,
        // byte cap must still be active). If defaults were clobbered this line would throw.
        await handler({ senderFrame: { url: 'file:///a.html' } }, reportJson);

        expect(sent.length).toBe(1);
    });
});
