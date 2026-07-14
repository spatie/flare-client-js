import { createIdentityTagger } from '@flareapp/core';
import type { Flare } from '@flareapp/js/browser';

import { PACKAGE_VERSION } from './constants';

const tagger = createIdentityTagger({
    sdkName: '@flareapp/vue',
    sdkVersion: PACKAGE_VERSION,
    frameworkName: 'Vue',
});

/** Web path: SDK identity only; the framework version (app.version) is only known at install time. */
export function registerVueSdkInfo(flare: Flare): void {
    tagger.registerSdkIdentity(flare);
}

/** Both paths tag the framework; never touches sdkInfo (would clobber an injected SDK name). */
export function tagVueFramework(flare: Flare, appVersion: string | undefined): void {
    tagger.tagFramework(flare, appVersion);
}
