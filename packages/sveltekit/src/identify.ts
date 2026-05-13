import { flare } from '@flareapp/js';

import { PACKAGE_VERSION } from './constants';

let registered = false;

export function registerSvelteKitSdkIdentity(): void {
    if (registered) return;
    registered = true;

    flare.setSdkInfo({ name: '@flareapp/sveltekit', version: PACKAGE_VERSION });
    flare.setFramework({ name: 'SvelteKit' });
}
