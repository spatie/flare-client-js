import { FLARE_BRIDGE_KEY, RendererFlare } from '@flareapp/electron/renderer';
import { render } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// Drives the full inject-entry path (boundary -> reportSilently -> RendererFlare.sendReport -> bridge)
// with real components. Complements the electron cross-package test, which covers flareReactErrorHandler.
import { FlareErrorBoundary } from '../src/inject';

function ThrowingComponent(): React.ReactElement {
    throw new Error('boom from boundary');
}

describe('@flareapp/react/inject FlareErrorBoundary through the RendererFlare bridge', () => {
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

        render(
            <FlareErrorBoundary flare={flare} fallback={<div>fallback</div>}>
                <ThrowingComponent />
            </FlareErrorBoundary>,
        );

        await flare.flush(1000);

        expect(bridgeReport).toHaveBeenCalledOnce();
        const payload = bridgeReport.mock.calls[0][0];
        expect(typeof payload).toBe('string');

        const parsed = JSON.parse(payload);
        expect(parsed.attributes['telemetry.sdk.name']).toBe('@flareapp/electron');
        expect(parsed.attributes['flare.framework.name']).toBe('react');
        expect(parsed.attributes['context.custom'].react).toBeDefined();
    });
});
