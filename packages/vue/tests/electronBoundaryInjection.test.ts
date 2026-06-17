import { FLARE_BRIDGE_KEY, RendererFlare } from '@flareapp/electron/renderer';
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { defineComponent, h } from 'vue';

// The REAL inject entry boundary + a real Electron RendererFlare. Drives the full path:
// boundary resolves the injected instance at setup -> reportSilently -> RendererFlare.sendReport
// -> bridge. (The existing electron cross-package test covers the flareVue plugin path; this closes
// the gap for the FlareErrorBoundary component end-to-end through the bridge.)
import { FlareErrorBoundary } from '../src/inject';

const ThrowingChild = defineComponent({
    setup() {
        throw new Error('boom from boundary');
    },
    render: () => null,
});

describe('@flareapp/vue/inject FlareErrorBoundary through the RendererFlare bridge', () => {
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

        mount(FlareErrorBoundary, {
            props: { flare: flare as never },
            slots: { default: () => h(ThrowingChild) },
        });

        await flare.flush(1000);

        expect(bridgeReport).toHaveBeenCalledOnce();
        const payload = bridgeReport.mock.calls[0][0];
        expect(typeof payload).toBe('string');

        const parsed = JSON.parse(payload);
        expect(parsed.attributes['telemetry.sdk.name']).toBe('@flareapp/electron');
        expect(parsed.attributes['flare.framework.name']).toBe('Vue');
        expect(parsed.attributes['context.custom'].vue).toBeDefined();
    });
});
