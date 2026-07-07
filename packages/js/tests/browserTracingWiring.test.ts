// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { Flare } from '../src/browser';
import { stopBrowserTracing } from '../src/tracing/browserTracing';
import { unpatchFetch } from '../src/tracing/instrumentFetch';
import { unpatchXHR } from '../src/tracing/instrumentXHR';

describe('Flare browser tracing wiring', () => {
    afterEach(() => {
        stopBrowserTracing();
        unpatchFetch();
        unpatchXHR();
    });

    it('enabling tracing starts a pageload root (active), disabling clears it', () => {
        const flare = new Flare();
        expect(flare.tracer.getActiveSpan()).toBeUndefined();

        flare.configure({ enableTracing: true });
        expect(flare.tracer.getActiveSpan()).toBeDefined(); // pageload root is the active root

        flare.configure({ enableTracing: false });
        expect(flare.tracer.getActiveSpan()).toBeUndefined();
    });

    it('pagehide ends the open pageload root so it ships with its children', () => {
        const flare = new Flare();
        flare.configure({ enableTracing: true });
        expect(flare.tracer.getActiveSpan()).toBeDefined();

        window.dispatchEvent(new Event('pagehide'));

        expect(flare.tracer.getActiveSpan()).toBeUndefined(); // root ended, not left open on unload
    });

    it('enabling tracing patches XMLHttpRequest.prototype.send, disabling restores it', () => {
        const proto = XMLHttpRequest.prototype as unknown as Record<string, { __flare_original__?: unknown }>;
        const nativeSend = proto.send;
        const flare = new Flare();

        flare.configure({ enableTracing: true });
        expect((proto.send as { __flare_original__?: unknown }).__flare_original__).toBe(nativeSend);

        flare.configure({ enableTracing: false });
        expect(proto.send).toBe(nativeSend);
    });
});
