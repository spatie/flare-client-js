import type { Flare } from '@flareapp/js/browser';

import { PACKAGE_VERSION } from './version.js';

// Per-instance guards: a singleton and an injected RendererFlare must each be tagged independently.
const sdkTagged = new WeakSet<object>();
const frameworkTagged = new WeakSet<object>();

/** Web path: full identity on the default singleton (sdk + framework). Svelte's framework has no version. */
export function registerSvelteSdkIdentity(flare: Flare): void {
    if (!sdkTagged.has(flare)) {
        sdkTagged.add(flare);
        flare.setSdkInfo({ name: '@flareapp/svelte', version: PACKAGE_VERSION });
    }
    tagSvelteFramework(flare);
}

/**
 * Injected path: framework tag only. Never touch sdkInfo, which would clobber the injected
 * instance's own SDK name (e.g. @flareapp/electron).
 */
export function tagSvelteFramework(flare: Flare): void {
    if (frameworkTagged.has(flare)) {
        return;
    }
    frameworkTagged.add(flare);
    flare.setFramework({ name: 'Svelte' });
}
