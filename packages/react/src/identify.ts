import type { Flare } from '@flareapp/js/browser';
import * as React from 'react';

import { PACKAGE_VERSION } from './constants';

// Per-instance guards. A boolean cannot serve injection: with a singleton AND an
// injected RendererFlare, each instance must be tagged independently.
const sdkTagged = new WeakSet<object>();
const frameworkTagged = new WeakSet<object>();

// Web path: full identity on the default singleton (sdk + framework).
export function registerReactSdkIdentity(flare: Flare): void {
    if (!sdkTagged.has(flare)) {
        sdkTagged.add(flare);
        flare.setSdkInfo({ name: '@flareapp/react', version: PACKAGE_VERSION });
    }
    tagReactFramework(flare);
}

// Injected path: framework tag ONLY. Never touch sdkInfo — that would clobber the
// injected instance's own SDK name (e.g. @flareapp/electron).
export function tagReactFramework(flare: Flare): void {
    if (frameworkTagged.has(flare)) {
        return;
    }
    frameworkTagged.add(flare);
    flare.setFramework({ name: 'React', version: React.version });
}
