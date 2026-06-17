// The REAL published inject entry (built dist). Importing it must not pull the js root.
// Runs in electron's default `node` env — the vue error path needs no DOM (RendererFlare
// forwards via globalThis[FLARE_BRIDGE_KEY], not window).
import { flareVue } from '@flareapp/vue/inject';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createApp } from 'vue';

import { FLARE_BRIDGE_KEY } from '../src/constants';
import { RendererFlare } from '../src/renderer/RendererFlare';

describe('@flareapp/vue/inject reports through an injected RendererFlare', () => {
    let bridgeReport: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        bridgeReport = vi.fn(async () => {});
        (globalThis as Record<string, unknown>)[FLARE_BRIDGE_KEY] = { report: bridgeReport };
    });

    afterEach(() => {
        delete (globalThis as Record<string, unknown>)[FLARE_BRIDGE_KEY];
    });

    test('forwards a STRING payload carrying Vue context.custom over the bridge', async () => {
        const flare = new RendererFlare();

        const app = createApp({ render: () => null });
        app.use(flareVue, { flare });

        // Drive Vue's installed error handler directly.
        app.config.errorHandler!(new Error('boom'), null, 'render function');

        await flare.flush(1000);

        expect(bridgeReport).toHaveBeenCalledOnce();
        const payload = bridgeReport.mock.calls[0][0];
        expect(typeof payload).toBe('string');

        const parsed = JSON.parse(payload);
        expect(parsed.attributes['telemetry.sdk.name']).toBe('@flareapp/electron');
        expect(parsed.attributes['flare.framework.name']).toBe('Vue');
        expect(parsed.attributes['context.custom'].vue).toBeDefined();
        expect((globalThis as Record<string, unknown>).flare).toBeUndefined();
    });
});
