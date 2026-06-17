import { beforeEach, describe, expect, test, vi } from 'vitest';

describe('@flareapp/svelte web entry', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    test('importing the root sets SDK identity at import AND registers the singleton as default', async () => {
        const setSdkInfo = vi.fn();
        const setFramework = vi.fn();
        const singleton = { setSdkInfo, setFramework, reportSilently: vi.fn() };
        vi.doMock('@flareapp/js', () => ({ flare: singleton }));

        await import('../src/index.js');

        // SvelteKit contract: identity is set at IMPORT (module load), not deferred.
        expect(setSdkInfo).toHaveBeenCalledWith(expect.objectContaining({ name: '@flareapp/svelte' }));
        expect(setFramework).toHaveBeenCalledWith({ name: 'Svelte' });

        // default provider registered for no-option usage
        const { resolveFlare } = await import('../src/resolveFlare.js');
        expect(resolveFlare()).toBe(singleton);
    });
});
