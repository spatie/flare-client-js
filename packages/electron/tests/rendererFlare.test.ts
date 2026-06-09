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
});
