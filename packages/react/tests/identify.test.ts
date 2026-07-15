import { fakeIdentity } from '@flareapp/test-helpers';
import { beforeEach, describe, expect, test, vi } from 'vitest';

describe('react identity', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    test('registerReactSdkIdentity sets sdkInfo (@flareapp/react) and framework (React)', async () => {
        const { registerReactSdkIdentity } = await import('../src/identify');
        const flare = fakeIdentity() as any;
        registerReactSdkIdentity(flare);
        expect(flare.setSdkInfo).toHaveBeenCalledWith(expect.objectContaining({ name: '@flareapp/react' }));
        expect(flare.setFramework).toHaveBeenCalledWith(expect.objectContaining({ name: 'React' }));
    });

    test('tagReactFramework sets framework only, never sdkInfo', async () => {
        const { tagReactFramework } = await import('../src/identify');
        const flare = fakeIdentity() as any;
        tagReactFramework(flare);
        expect(flare.setFramework).toHaveBeenCalledWith(expect.objectContaining({ name: 'React' }));
        expect(flare.setSdkInfo).not.toHaveBeenCalled();
    });

    test('each guard is per-instance: same instance tagged once, distinct instances each tagged', async () => {
        const { tagReactFramework } = await import('../src/identify');
        const a = fakeIdentity() as any;
        const b = fakeIdentity() as any;
        tagReactFramework(a);
        tagReactFramework(a);
        tagReactFramework(b);
        expect(a.setFramework).toHaveBeenCalledOnce();
        expect(b.setFramework).toHaveBeenCalledOnce();
    });
});
