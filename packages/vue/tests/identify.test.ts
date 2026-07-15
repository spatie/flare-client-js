import { fakeIdentity } from '@flareapp/test-helpers';
import { beforeEach, describe, expect, test, vi } from 'vitest';

describe('vue identity', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    test('registerVueSdkInfo sets sdkInfo (@flareapp/vue) only, never framework', async () => {
        const { registerVueSdkInfo } = await import('../src/identify');
        const flare = fakeIdentity() as any;
        registerVueSdkInfo(flare);
        expect(flare.setSdkInfo).toHaveBeenCalledWith(expect.objectContaining({ name: '@flareapp/vue' }));
        expect(flare.setFramework).not.toHaveBeenCalled();
    });

    test('tagVueFramework sets framework (Vue + version) only, never sdkInfo', async () => {
        const { tagVueFramework } = await import('../src/identify');
        const flare = fakeIdentity() as any;
        tagVueFramework(flare, '3.4.0');
        expect(flare.setFramework).toHaveBeenCalledWith({ name: 'Vue', version: '3.4.0' });
        expect(flare.setSdkInfo).not.toHaveBeenCalled();
    });

    test('each guard is per-instance: same instance tagged once, distinct instances each tagged', async () => {
        const { tagVueFramework } = await import('../src/identify');
        const a = fakeIdentity() as any;
        const b = fakeIdentity() as any;
        tagVueFramework(a, '3.4.0');
        tagVueFramework(a, '3.4.0');
        tagVueFramework(b, '3.4.0');
        expect(a.setFramework).toHaveBeenCalledOnce();
        expect(b.setFramework).toHaveBeenCalledOnce();
    });
});
