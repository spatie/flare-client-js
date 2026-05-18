import { flare } from '@flareapp/js';
import { version as svelteVersion } from 'svelte/package.json';

import { PACKAGE_VERSION } from './constants.js';

let registered = false;

export function registerSvelteSdkIdentity(): void {
    if (registered) return;
    registered = true;

    flare.setSdkInfo({ name: '@flareapp/svelte', version: PACKAGE_VERSION });
    flare.setFramework({ name: 'Svelte', version: svelteVersion });
}
