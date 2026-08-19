// @vitest-environment jsdom
import { browserSeamStub } from '@flareapp/test-helpers';
import { beforeEach, describe, expect, test, vi } from 'vitest';

describe('@flareapp/inertia entry', () => {
    beforeEach(() => {
        vi.resetModules();
        delete (window as unknown as { flare?: unknown }).flare;
    });

    test('importing the entry does not evaluate the @flareapp/js root singleton', async () => {
        const rootFactory = vi.fn(() => ({ flare: {} }));
        vi.doMock('@flareapp/js', rootFactory);
        vi.doMock('@flareapp/js/browser', () => browserSeamStub());

        await import('../src/index');

        expect(rootFactory).not.toHaveBeenCalled();
        expect((window as unknown as { flare?: unknown }).flare).toBeUndefined();
    });

    test('importing the entry registers nothing', async () => {
        // "sideEffects": false, and the README says to call this before flare.light(). Registering a
        // navigation source at import time would break both.
        const registerNavigationSource = vi.fn(() => ({}));
        vi.doMock('@flareapp/js/browser', () => browserSeamStub({ registerNavigationSource }));

        const mod = await import('../src/index');

        expect(typeof mod.traceInertiaRouter).toBe('function');
        expect(registerNavigationSource).not.toHaveBeenCalled();
    });
});
