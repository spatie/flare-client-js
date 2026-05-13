import { flare } from '@flareapp/js';

import { PACKAGE_VERSION } from './constants';

export function registerSvelteKitSdkIdentity(): void {
    flare.setSdkInfo({ name: '@flareapp/sveltekit', version: PACKAGE_VERSION });
    flare.setFramework({ name: 'SvelteKit' });
}
