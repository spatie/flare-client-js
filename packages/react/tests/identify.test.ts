import { beforeEach, describe, expect, test, vi } from 'vitest';

function fakeFlare() {
    return { setSdkInfo: vi.fn(), setFramework: vi.fn() } as any;
}

describe('react identity', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    test('registerReactSdkIdentity sets sdkInfo (@flareapp/react) and framework (React)', async () => {
        const { registerReactSdkIdentity } = await import('../src/identify');
        const flare = fakeFlare();
        registerReactSdkIdentity(flare);
        expect(flare.setSdkInfo).toHaveBeenCalledWith(expect.objectContaining({ name: '@flareapp/react' }));
        expect(flare.setFramework).toHaveBeenCalledWith(expect.objectContaining({ name: 'React' }));
    });

    test('tagReactFramework sets framework only, never sdkInfo', async () => {
        const { tagReactFramework } = await import('../src/identify');
        const flare = fakeFlare();
        tagReactFramework(flare);
        expect(flare.setFramework).toHaveBeenCalledWith(expect.objectContaining({ name: 'React' }));
        expect(flare.setSdkInfo).not.toHaveBeenCalled();
    });

    test('each guard is per-instance: same instance tagged once, distinct instances each tagged', async () => {
        const { tagReactFramework } = await import('../src/identify');
        const a = fakeFlare();
        const b = fakeFlare();
        tagReactFramework(a);
        tagReactFramework(a);
        tagReactFramework(b);
        expect(a.setFramework).toHaveBeenCalledOnce();
        expect(b.setFramework).toHaveBeenCalledOnce();
    });
});
