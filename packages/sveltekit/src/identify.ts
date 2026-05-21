import { flare } from '@flareapp/js';

import { PACKAGE_VERSION } from './version.js';

/**
 * Called on every error report (not just once) to ensure the SDK identity is '@flareapp/sveltekit'.
 * Must override @flareapp/svelte's module-level registration, which runs earlier due to import order.
 */
export function registerSvelteKitSdkIdentity(): void {
    flare.setSdkInfo({ name: '@flareapp/sveltekit', version: PACKAGE_VERSION });
    flare.setFramework({ name: 'SvelteKit' });
}
