// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { RendererFlare } from '../src/renderer/RendererFlare';

describe('RendererFlare', () => {
    beforeEach(() => {
        // @ts-expect-error test global
        delete (window as any).__flare;
        vi.restoreAllMocks();
    });

    it('forwards a serialized string to window.__flare.report (no key required)', async () => {
        const forwarded: string[] = [];
        (window as any).__flare = {
            report: (s: string) => {
                forwarded.push(s);
                return Promise.resolve();
            },
        };
        const flare = new RendererFlare();
        await flare.report(new Error('renderer boom'));
        expect(forwarded.length).toBe(1);
        const parsed = JSON.parse(forwarded[0]);
        expect(parsed.attributes['telemetry.sdk.name']).toBe('@flareapp/electron');
        expect(String(parsed.message)).toContain('renderer boom');
    });

    it('serializes a report whose context contains a cycle (flatJsonStringify) without throwing', async () => {
        const forwarded: string[] = [];
        (window as any).__flare = {
            report: (s: string) => {
                forwarded.push(s);
                return Promise.resolve();
            },
        };
        const flare = new RendererFlare();
        const cyclic: any = {};
        cyclic.self = cyclic;
        flare.addContextGroup('cycle', cyclic);
        await flare.report(new Error('cyclic'));
        expect(forwarded.length).toBe(1);
    });

    it('runs the renderer beforeSubmit (captured via configure) before forwarding', async () => {
        const forwarded: string[] = [];
        (window as any).__flare = {
            report: (s: string) => {
                forwarded.push(s);
                return Promise.resolve();
            },
        };
        const flare = new RendererFlare();
        flare.configure({
            beforeSubmit: (r) => {
                r.attributes['scrubbed'] = true;
                return r;
            },
        });
        await flare.report(new Error('x'));
        expect(JSON.parse(forwarded[0]).attributes['scrubbed']).toBe(true);
    });

    it('drops a report exceeding maxReportBytes', async () => {
        const forwarded: string[] = [];
        (window as any).__flare = {
            report: (s: string) => {
                forwarded.push(s);
                return Promise.resolve();
            },
        };
        const flare = new RendererFlare({ maxReportBytes: 10 });
        await flare.report(new Error('way too big to fit in ten bytes'));
        expect(forwarded.length).toBe(0);
    });

    it('warns once and does not throw when the bridge is missing', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const flare = new RendererFlare();
        await flare.report(new Error('no bridge'));
        await flare.report(new Error('still no bridge'));
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('does not throw when the bridge.report call rejects', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        (window as any).__flare = { report: () => Promise.reject(new Error('IPC boom')) };
        const flare = new RendererFlare();
        await expect(flare.report(new Error('x'))).resolves.toBeUndefined();
        await flare.report(new Error('y'));
        expect(warn).toHaveBeenCalledTimes(1); // warn-once on send failure
    });
});

describe('renderer entry global wiring', () => {
    it('a window error event reaches the bridge transport', async () => {
        // @ts-expect-error test global
        delete (window as any).__flare;
        const forwarded: string[] = [];
        (window as any).__flare = {
            report: (s: string) => {
                forwarded.push(s);
                return Promise.resolve();
            },
        };
        // Importing the entry installs window.flare and the error listeners.
        await import('../src/renderer');
        window.dispatchEvent(new ErrorEvent('error', { error: new Error('from window'), message: 'from window' }));
        // Let the async report pipeline settle.
        await new Promise((r) => setTimeout(r, 10));
        expect(forwarded.length).toBeGreaterThanOrEqual(1);
        expect(String(JSON.parse(forwarded[0]).message)).toContain('from window');
    });
});
