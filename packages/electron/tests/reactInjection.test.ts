// The REAL published inject entry (built dist). Importing it must not pull the js root.
// Runs in electron's default `node` test environment — the inject path needs no DOM
// (RendererFlare forwards via globalThis[FLARE_BRIDGE_KEY], not window).
import { flareReactErrorHandler } from '@flareapp/react/inject';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { FLARE_BRIDGE_KEY } from '../src/constants';
import { RendererFlare } from '../src/renderer/RendererFlare';

describe('@flareapp/react/inject reports through an injected RendererFlare', () => {
    let bridgeReport: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        bridgeReport = vi.fn(async () => {});
        (globalThis as Record<string, unknown>)[FLARE_BRIDGE_KEY] = { report: bridgeReport };
    });

    afterEach(() => {
        delete (globalThis as Record<string, unknown>)[FLARE_BRIDGE_KEY];
    });

    test('forwards a STRING payload carrying React context.custom over the bridge', async () => {
        const flare = new RendererFlare();

        // Handler resolves and tags the injected instance at creation (no js-root default).
        const handler = flareReactErrorHandler({ flare });

        // React passes the component stack as a string with "at <Component>" lines.
        handler(new Error('boom'), { componentStack: '\n    at App (http://localhost/src/App.tsx:5:10)' });

        // reportSilently is fire-and-forget; drain the in-flight report.
        await flare.flush(1000);

        expect(bridgeReport).toHaveBeenCalledOnce();
        const payload = bridgeReport.mock.calls[0][0];
        expect(typeof payload).toBe('string');

        const parsed = JSON.parse(payload);
        // SDK identity stays electron's (injected instance's own sdkInfo, never clobbered)...
        expect(parsed.attributes['telemetry.sdk.name']).toBe('@flareapp/electron');
        // ...while react tags the framework. Core emits framework as an attribute.
        expect(parsed.attributes['flare.framework.name']).toBe('React');
        // React context survives the serialize + (would-be) IPC trip intact.
        const reactCtx = parsed.attributes['context.custom'].react;
        expect(Array.isArray(reactCtx.componentStack)).toBe(true);
        expect(reactCtx.componentStack.join(' ')).toContain('App');
        // No-root is guarded authoritatively by react's dist-grep (verify:inject); importing
        // the inject entry here additionally must not have installed any global flare singleton.
        expect((globalThis as Record<string, unknown>).flare).toBeUndefined();
    });
});
