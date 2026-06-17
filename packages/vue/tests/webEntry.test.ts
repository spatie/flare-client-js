import { beforeEach, describe, expect, test, vi } from 'vitest';

describe('@flareapp/vue web entry', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    test('importing the root registers the js singleton as the resolveFlare default', async () => {
        const singleton = { reportSilently: vi.fn(), setSdkInfo: vi.fn(), setFramework: vi.fn() };
        vi.doMock('@flareapp/js', () => ({ flare: singleton }));

        await import('../src/index');

        const { resolveFlare } = await import('../src/resolveFlare');
        expect(resolveFlare()).toBe(singleton);
    });
});
