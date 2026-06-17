import { beforeEach, describe, expect, test, vi } from 'vitest';

function fakeFlare() {
    return { setSdkInfo: vi.fn(), setFramework: vi.fn() } as any;
}

describe('vue identity', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    test('registerVueSdkInfo sets sdkInfo (@flareapp/vue) only, never framework', async () => {
        const { registerVueSdkInfo } = await import('../src/identify');
        const flare = fakeFlare();
        registerVueSdkInfo(flare);
        expect(flare.setSdkInfo).toHaveBeenCalledWith(expect.objectContaining({ name: '@flareapp/vue' }));
        expect(flare.setFramework).not.toHaveBeenCalled();
    });

    test('tagVueFramework sets framework (Vue + version) only, never sdkInfo', async () => {
        const { tagVueFramework } = await import('../src/identify');
        const flare = fakeFlare();
        tagVueFramework(flare, '3.4.0');
        expect(flare.setFramework).toHaveBeenCalledWith({ name: 'Vue', version: '3.4.0' });
        expect(flare.setSdkInfo).not.toHaveBeenCalled();
    });

    test('each guard is per-instance: same instance tagged once, distinct instances each tagged', async () => {
        const { tagVueFramework } = await import('../src/identify');
        const a = fakeFlare();
        const b = fakeFlare();
        tagVueFramework(a, '3.4.0');
        tagVueFramework(a, '3.4.0');
        tagVueFramework(b, '3.4.0');
        expect(a.setFramework).toHaveBeenCalledOnce();
        expect(b.setFramework).toHaveBeenCalledOnce();
    });
});
