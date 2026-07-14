import { describe, expect, it, vi } from 'vitest';

import { createIdentityTagger } from '../src/util/createIdentityTagger';

function fakeFlare() {
    return { setSdkInfo: vi.fn(), setFramework: vi.fn() };
}

describe('createIdentityTagger', () => {
    it('sets sdk info once and tags framework once with a version', () => {
        const t = createIdentityTagger({ sdkName: '@flareapp/react', sdkVersion: '1.2.3', frameworkName: 'React' });
        const flare = fakeFlare();
        t.registerSdkIdentity(flare);
        t.registerSdkIdentity(flare);
        t.tagFramework(flare, '19.0.0');
        t.tagFramework(flare, '19.0.0');
        expect(flare.setSdkInfo).toHaveBeenCalledTimes(1);
        expect(flare.setSdkInfo).toHaveBeenCalledWith({ name: '@flareapp/react', version: '1.2.3' });
        expect(flare.setFramework).toHaveBeenCalledTimes(1);
        expect(flare.setFramework).toHaveBeenCalledWith({ name: 'React', version: '19.0.0' });
    });

    it('omits the version key when frameworkVersion is undefined', () => {
        const t = createIdentityTagger({ sdkName: '@flareapp/svelte', sdkVersion: '1.0.0', frameworkName: 'Svelte' });
        const flare = fakeFlare();
        t.tagFramework(flare, undefined);
        expect(flare.setFramework).toHaveBeenCalledWith({ name: 'Svelte' });
    });

    it('keeps per-instance state (two taggers do not share WeakSets)', () => {
        const t1 = createIdentityTagger({ sdkName: '@flareapp/react', sdkVersion: '1', frameworkName: 'React' });
        const t2 = createIdentityTagger({ sdkName: '@flareapp/vue', sdkVersion: '1', frameworkName: 'Vue' });
        const flare = fakeFlare();
        t1.registerSdkIdentity(flare);
        t2.registerSdkIdentity(flare);
        expect(flare.setSdkInfo).toHaveBeenCalledTimes(2);
    });
});
