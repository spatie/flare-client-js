import { createIdentityTagger } from '@flareapp/core';
import type { Flare } from '@flareapp/js/browser';
import * as React from 'react';

import { PACKAGE_VERSION } from './constants';

const tagger = createIdentityTagger({
    sdkName: '@flareapp/react',
    sdkVersion: PACKAGE_VERSION,
    frameworkName: 'React',
});

/** Web path: full identity on the default singleton (sdk + framework). */
export function registerReactSdkIdentity(flare: Flare): void {
    tagger.registerSdkIdentity(flare);
    tagger.tagFramework(flare, React.version);
}

/** Injected path: framework tag only, never sdkInfo (would clobber the injected SDK name). */
export function tagReactFramework(flare: Flare): void {
    tagger.tagFramework(flare, React.version);
}
