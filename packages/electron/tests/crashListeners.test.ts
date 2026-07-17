import { FakeApi } from '@flareapp/test-helpers';
import { describe, expect, it, vi } from 'vitest';

import { ElectronFlare } from '../src/main/ElectronFlare';

function makeFlare() {
    const appHandlers: Record<string, Function[]> = {};
    const offCalls: { event: string; cb: Function }[] = [];
    const app = {
        getName: () => 'A',
        getVersion: () => '1',
        getLocale: () => 'en',
        isReady: () => true,
        isPackaged: false,
        exit: vi.fn(),
        on: (event: string, cb: Function) => {
            (appHandlers[event] ??= []).push(cb);
        },
        off: (event: string, cb: Function) => {
            offCalls.push({ event, cb });
        },
    };
    const ipcMain = { handle: vi.fn(), removeHandler: vi.fn() };
    const api = new FakeApi();
    const flare = new ElectronFlare({ app: app as any, ipcMain: ipcMain as any });
    flare.api = api;
    flare.light('k');
    return { flare, api, appHandlers, offCalls };
}

describe('crash listeners', () => {
    it('render-process-gone reports reason, exitCode, kind, and affected web contents id', async () => {
        const { api, appHandlers } = makeFlare();
        const cb = appHandlers['render-process-gone'][0];
        await cb({}, { id: 42 }, { reason: 'crashed', exitCode: 133 });
        expect(api.reports.length).toBe(1);
        const a = api.reports[0].attributes;
        expect(a['electron.process_gone.kind']).toBe('renderer');
        expect(a['electron.process_gone.reason']).toBe('crashed');
        expect(a['electron.process_gone.exit_code']).toBe(133);
        expect(a['electron.process_gone.web_contents_id']).toBe(42);
        expect(String(api.reports[0].message)).toContain('crashed');
    });

    it('child-process-gone reports the child process type and kind', async () => {
        const { api, appHandlers } = makeFlare();
        const cb = appHandlers['child-process-gone'][0];
        await cb({}, { reason: 'crashed', exitCode: 5, type: 'GPU', serviceName: 'gpu-process' });
        expect(api.reports.length).toBe(1);
        const a = api.reports[0].attributes;
        expect(a['electron.process_gone.kind']).toBe('child');
        expect(a['electron.process_gone.type']).toBe('GPU');
        expect(a['electron.process_gone.service_name']).toBe('gpu-process');
        expect(a['electron.process_gone.exit_code']).toBe(5);
    });

    it('configureElectron({ captureRenderProcessGone: false }) detaches the listeners', () => {
        const { flare, appHandlers, offCalls } = makeFlare();
        expect(appHandlers['render-process-gone']?.length).toBe(1);
        flare.configureElectron({ captureRenderProcessGone: false });
        expect(offCalls.map((c) => c.event)).toContain('render-process-gone');
        expect(offCalls.map((c) => c.event)).toContain('child-process-gone');
    });

    it('dispose detaches the crash listeners using the same refs that were attached', () => {
        const { flare, appHandlers, offCalls } = makeFlare();
        const attachedRender = appHandlers['render-process-gone'][0];
        const attachedChild = appHandlers['child-process-gone'][0];
        flare.dispose();
        const offRender = offCalls.find((c) => c.event === 'render-process-gone');
        const offChild = offCalls.find((c) => c.event === 'child-process-gone');
        expect(offRender?.cb).toBe(attachedRender);
        expect(offChild?.cb).toBe(attachedChild);
    });

    it('toggling captureRenderProcessGone off then on re-attaches exactly one handler; redundant off is a no-op', () => {
        const { flare, appHandlers, offCalls } = makeFlare();
        expect(appHandlers['render-process-gone'].length).toBe(1);

        flare.configureElectron({ captureRenderProcessGone: false });
        const offCountAfterFirstDisable = offCalls.length;

        // Redundant disable: should not call off again.
        flare.configureElectron({ captureRenderProcessGone: false });
        expect(offCalls.length).toBe(offCountAfterFirstDisable);

        // Re-enable: exactly one more handler attached for each event (total 2, not 3).
        flare.configureElectron({ captureRenderProcessGone: true });
        expect(appHandlers['render-process-gone'].length).toBe(2);
        expect(appHandlers['child-process-gone'].length).toBe(2);
    });
});
