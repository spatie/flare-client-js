// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from 'vitest';

describe('@flareapp/react/inject entry', () => {
    beforeEach(() => {
        vi.resetModules();
        delete (window as any).flare;
    });

    test('importing the inject entry does NOT evaluate @flareapp/js root', async () => {
        const rootFactory = vi.fn(() => ({ flare: {} }));
        vi.doMock('@flareapp/js', rootFactory);

        await import('../src/inject');

        // Root module never imported -> its mock factory never ran, no window.flare installed.
        expect(rootFactory).not.toHaveBeenCalled();
        expect((window as any).flare).toBeUndefined();
    });

    test('exports the boundary and handler', async () => {
        const mod = await import('../src/inject');
        expect(typeof mod.FlareErrorBoundary).toBe('function');
        expect(typeof mod.flareReactErrorHandler).toBe('function');
    });

    test('boundary from inject entry throws at construction when no instance and no default', async () => {
        const { FlareErrorBoundary } = await import('../src/inject');
        // No registerDefaultFlare ran (root not imported), so resolveFlare throws.
        expect(() => new (FlareErrorBoundary as any)({})).toThrow(/No Flare instance available/);
    });
});
