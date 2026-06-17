import { FLARE_BRIDGE_KEY, RendererFlare } from '@flareapp/electron/renderer';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// The REAL inject entry. Importing it must not pull the js root.
import { createFlareErrorHandler } from '../src/inject.js';

describe('@flareapp/svelte/inject reports through an injected RendererFlare', () => {
    let bridgeReport: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        bridgeReport = vi.fn(async () => {});
        (globalThis as Record<string, unknown>)[FLARE_BRIDGE_KEY] = { report: bridgeReport };
    });

    afterEach(() => {
        delete (globalThis as Record<string, unknown>)[FLARE_BRIDGE_KEY];
    });

    test('forwards a STRING payload carrying Svelte context.custom over the bridge', async () => {
        const flare = new RendererFlare();
        const handler = createFlareErrorHandler({ flare });

        await handler(new Error('boom'), () => {});
        await flare.flush(1000);

        expect(bridgeReport).toHaveBeenCalledOnce();
        const payload = bridgeReport.mock.calls[0][0];
        expect(typeof payload).toBe('string');

        const parsed = JSON.parse(payload);
        expect(parsed.attributes['telemetry.sdk.name']).toBe('@flareapp/electron');
        expect(parsed.attributes['flare.framework.name']).toBe('Svelte');
        expect(parsed.attributes['context.custom'].svelte).toBeDefined();
        // NOTE: do NOT assert window.flare/globalThis.flare is undefined — importing
        // @flareapp/electron/renderer legitimately sets window.flare (renderer.ts side effect).
        // No-root is covered by Task 9 (dist-grep) + Task 7 (runtime mock-factory check).
    });
});
