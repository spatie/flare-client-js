import { beforeEach, describe, expect, test, vi } from 'vitest';

// SvelteKit does `export * from '@flareapp/svelte'` and relies on (a) the web entry registering
// SDK identity AT IMPORT, and (b) the full export surface remaining intact so the re-export works.
describe('@flareapp/svelte web entry — SvelteKit contract', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    test('sets SDK identity at import (module-load), the ordering sveltekit overrides', async () => {
        const setSdkInfo = vi.fn();
        const singleton = { setSdkInfo, setFramework: vi.fn(), reportSilently: vi.fn() };
        vi.doMock('@flareapp/js', () => ({ flare: singleton }));
        await import('../src/index.js');
        expect(setSdkInfo).toHaveBeenCalledWith(expect.objectContaining({ name: '@flareapp/svelte' }));
    });

    test('re-export surface still includes everything sveltekit `export *`s', async () => {
        const singleton = { setSdkInfo: vi.fn(), setFramework: vi.fn(), reportSilently: vi.fn() };
        vi.doMock('@flareapp/js', () => ({ flare: singleton }));
        const mod = await import('../src/index.js');
        for (const name of [
            'FlareErrorBoundary',
            'createFlareErrorHandler',
            '__flareRegisterComponent',
            'getComponentTreeContext',
            'withFlareConfig',
            'flarePreprocessor',
        ]) {
            expect(mod, `missing export: ${name}`).toHaveProperty(name);
        }
    });
});
