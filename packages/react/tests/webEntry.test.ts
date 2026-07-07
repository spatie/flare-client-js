import { beforeEach, describe, expect, test, vi } from 'vitest';

describe('@flareapp/react web entry', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    test('importing the root registers the js singleton as the default and sets identity', async () => {
        const setSdkInfo = vi.fn();
        const setFramework = vi.fn();
        const singleton = { setSdkInfo, setFramework, reportSilently: vi.fn() };
        vi.doMock('@flareapp/js', () => ({ flare: singleton }));

        await import('../src/index');

        // Identity set on the singleton at import.
        expect(setSdkInfo).toHaveBeenCalledWith(expect.objectContaining({ name: '@flareapp/react' }));
        expect(setFramework).toHaveBeenCalledWith(expect.objectContaining({ name: 'React' }));

        // The singleton is now the resolveFlare default.
        const { resolveFlare } = await import('../src/resolveFlare');
        expect(resolveFlare()).toBe(singleton);
    });
});
