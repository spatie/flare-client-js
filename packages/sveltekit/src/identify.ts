import { flare, FrameworkName } from '@flareapp/js';

import { PACKAGE_VERSION } from './version.js';

// Re-run on every error report, because @flareapp/svelte registers its own identity at module level
// and import order puts it first.
export function registerSvelteKitSdkIdentity(): void {
    flare.setSdkInfo({ name: '@flareapp/sveltekit', version: PACKAGE_VERSION });
    flare.setFramework({ name: FrameworkName.SvelteKit });
}
