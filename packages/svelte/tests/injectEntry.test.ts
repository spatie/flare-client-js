import { beforeEach, describe, expect, test, vi } from 'vitest';

describe('@flareapp/svelte/inject entry', () => {
    beforeEach(() => {
        vi.resetModules();
        delete (window as any).flare;
    });

    test('importing the inject entry does NOT evaluate @flareapp/js root', async () => {
        const rootFactory = vi.fn(() => ({ flare: {} }));
        vi.doMock('@flareapp/js', rootFactory);

        await import('../src/inject.js');

        expect(rootFactory).not.toHaveBeenCalled();
        expect((window as any).flare).toBeUndefined();
    });

    test('exports createFlareErrorHandler and FlareErrorBoundary', async () => {
        const mod = await import('../src/inject.js');
        expect(typeof mod.createFlareErrorHandler).toBe('function');
        expect(mod.FlareErrorBoundary).toBeDefined();
    });

    test('createFlareErrorHandler from inject throws when no flare option and no default', async () => {
        const { createFlareErrorHandler } = await import('../src/inject.js');
        expect(() => createFlareErrorHandler()).toThrow(/No Flare instance available/);
    });
});
