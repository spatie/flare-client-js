import { fakeIdentity } from '@flareapp/test-helpers';
import { beforeEach, describe, expect, test, vi } from 'vitest';

describe('svelte identity', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    test('registerSvelteSdkIdentity sets sdkInfo (@flareapp/svelte) and framework (Svelte)', async () => {
        const { registerSvelteSdkIdentity } = await import('../src/identify.js');
        const flare = fakeIdentity() as any;
        registerSvelteSdkIdentity(flare);
        expect(flare.setSdkInfo).toHaveBeenCalledWith(expect.objectContaining({ name: '@flareapp/svelte' }));
        expect(flare.setFramework).toHaveBeenCalledWith({ name: 'Svelte' });
    });

    test('tagSvelteFramework sets framework only, never sdkInfo', async () => {
        const { tagSvelteFramework } = await import('../src/identify.js');
        const flare = fakeIdentity() as any;
        tagSvelteFramework(flare);
        expect(flare.setFramework).toHaveBeenCalledWith({ name: 'Svelte' });
        expect(flare.setSdkInfo).not.toHaveBeenCalled();
    });

    test('each guard is per-instance: same instance tagged once, distinct instances each tagged', async () => {
        const { tagSvelteFramework } = await import('../src/identify.js');
        const a = fakeIdentity() as any;
        const b = fakeIdentity() as any;
        tagSvelteFramework(a);
        tagSvelteFramework(a);
        tagSvelteFramework(b);
        expect(a.setFramework).toHaveBeenCalledOnce();
        expect(b.setFramework).toHaveBeenCalledOnce();
    });
});
