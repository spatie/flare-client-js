import { createIdentityTagger } from '@flareapp/core';
import type { Flare } from '@flareapp/js/browser';

import { PACKAGE_VERSION } from './version.js';

const tagger = createIdentityTagger({
    sdkName: '@flareapp/svelte',
    sdkVersion: PACKAGE_VERSION,
    frameworkName: 'Svelte',
});

/** Web path: full identity on the default singleton. Svelte's framework has no version. */
export function registerSvelteSdkIdentity(flare: Flare): void {
    tagger.registerSdkIdentity(flare);
    tagger.tagFramework(flare, undefined);
}

/** Injected path: framework tag only, never sdkInfo. */
export function tagSvelteFramework(flare: Flare): void {
    tagger.tagFramework(flare, undefined);
}
