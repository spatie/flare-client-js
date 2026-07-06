// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { Flare } from '../src/browser';
import { stopBrowserTracing } from '../src/tracing/browserTracing';
import { unpatchFetch } from '../src/tracing/instrumentFetch';

describe('Flare browser tracing wiring', () => {
    afterEach(() => {
        stopBrowserTracing();
        unpatchFetch();
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
});
