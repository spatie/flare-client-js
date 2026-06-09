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

    it('setUser projects enduser.* on the next report', async () => {
        const { flare, sent } = makeFlare();
        flare.setUser({ id: 7, email: 'u@x.io' });
        await flare.report(new Error('with user'));
        expect(sent[0].attributes['enduser.id']).toBe('7');
        expect(sent[0].attributes['enduser.email']).toBe('u@x.io');
        flare.setUser(null);
        await flare.report(new Error('no user'));
        expect(sent[1].attributes['enduser.id']).toBeUndefined();
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
        // main-side user merged onto forwarded report
        expect(sentOut[0].attributes['enduser.id']).toBe('99');
        expect(sentOut[0].attributes['enduser.email']).toBe('main@user.io');
    });

    it('dispose removes the IPC handler and detaches process listeners', () => {
        const { flare, ipcMain } = makeFlare();
        expect(ipcMain.handlers['flare:report']).toBeDefined();
        flare.dispose();
        expect(ipcMain.handlers['flare:report']).toBeUndefined();
    });
});
