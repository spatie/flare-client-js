import type { FrameworkName } from '../framework';
import type { Framework, SdkInfo } from '../types';

/** Minimal surface the tagger needs; the browser Flare and any subclass satisfy it structurally. */
export interface SdkTaggable {
    setSdkInfo(info: SdkInfo): unknown;
    setFramework(framework: Framework): unknown;
}

/**
 * A per-package SDK/framework identity tagger. Holds its own WeakSet guards, so each Flare instance
 * (singleton or injected renderer) gets each of the two tags at most once.
 *
 * `frameworkName` is `FrameworkName` rather than `string` because those are the exact values the backend
 * recognises, so a first-party package cannot invent one. A host app that needs its own name calls
 * `setFramework` directly.
 */
export function createIdentityTagger(config: { sdkName: string; sdkVersion: string; frameworkName: FrameworkName }): {
    registerSdkIdentity(flare: SdkTaggable): void;
    tagFramework(flare: SdkTaggable, frameworkVersion?: string): void;
} {
    const sdkTagged = new WeakSet<object>();
    const frameworkTagged = new WeakSet<object>();

    return {
        registerSdkIdentity(flare) {
            if (sdkTagged.has(flare)) {
                return;
            }
            sdkTagged.add(flare);
            flare.setSdkInfo({ name: config.sdkName, version: config.sdkVersion });
        },
        tagFramework(flare, frameworkVersion) {
            if (frameworkTagged.has(flare)) {
                return;
            }
            frameworkTagged.add(flare);
            flare.setFramework(
                frameworkVersion === undefined
                    ? { name: config.frameworkName }
                    : { name: config.frameworkName, version: frameworkVersion },
            );
        },
    };
}
