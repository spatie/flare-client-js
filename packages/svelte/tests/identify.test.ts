import { beforeEach, describe, expect, test, vi } from 'vitest';

function fakeFlare() {
    return { setSdkInfo: vi.fn(), setFramework: vi.fn() } as any;
}

describe('svelte identity', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    test('registerSvelteSdkIdentity sets sdkInfo (@flareapp/svelte) and framework (Svelte)', async () => {
        const { registerSvelteSdkIdentity } = await import('../src/identify.js');
        const flare = fakeFlare();
        registerSvelteSdkIdentity(flare);
        expect(flare.setSdkInfo).toHaveBeenCalledWith(expect.objectContaining({ name: '@flareapp/svelte' }));
        expect(flare.setFramework).toHaveBeenCalledWith({ name: 'Svelte' });
    });

    test('tagSvelteFramework sets framework only, never sdkInfo', async () => {
        const { tagSvelteFramework } = await import('../src/identify.js');
        const flare = fakeFlare();
        tagSvelteFramework(flare);
        expect(flare.setFramework).toHaveBeenCalledWith({ name: 'Svelte' });
        expect(flare.setSdkInfo).not.toHaveBeenCalled();
    });

    test('each guard is per-instance: same instance tagged once, distinct instances each tagged', async () => {
        const { tagSvelteFramework } = await import('../src/identify.js');
        const a = fakeFlare();
        const b = fakeFlare();
        tagSvelteFramework(a);
        tagSvelteFramework(a);
        tagSvelteFramework(b);
        expect(a.setFramework).toHaveBeenCalledOnce();
        expect(b.setFramework).toHaveBeenCalledOnce();
    });
});
