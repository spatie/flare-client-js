import { flare } from '@flareapp/js';

import { PACKAGE_VERSION } from './version.js';

let registered = false;

export function registerSvelteSdkIdentity(): void {
    if (registered) return;
    registered = true;

    flare.setSdkInfo({ name: '@flareapp/svelte', version: PACKAGE_VERSION });
    flare.setFramework({ name: 'Svelte' });
}
