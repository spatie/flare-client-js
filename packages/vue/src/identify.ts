import type { Flare } from '@flareapp/js/browser';

import { PACKAGE_VERSION } from './constants';

// Per-instance guards. A boolean can't serve injection: with a singleton and an injected
// RendererFlare, each instance must be tagged independently.
const sdkTagged = new WeakSet<object>();
const frameworkTagged = new WeakSet<object>();

/**
 * Web path: SDK identity on the default singleton. Split from framework because the framework
 * version (app.version) is only known at install time.
 */
export function registerVueSdkInfo(flare: Flare): void {
    if (sdkTagged.has(flare)) {
        return;
    }
    sdkTagged.add(flare);
    flare.setSdkInfo({ name: '@flareapp/vue', version: PACKAGE_VERSION });
}

/**
 * Both paths (web + injected) tag the framework. Never touches sdkInfo, which on an injected
 * instance would clobber the instance's own SDK name (@flareapp/electron).
 */
export function tagVueFramework(flare: Flare, appVersion: string | undefined): void {
    if (frameworkTagged.has(flare)) {
        return;
    }
    frameworkTagged.add(flare);
    flare.setFramework({ name: 'Vue', version: appVersion });
}
