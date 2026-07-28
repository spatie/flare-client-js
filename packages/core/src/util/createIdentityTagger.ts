import type { FrameworkName } from '../framework';
import type { Framework, SdkInfo } from '../types';

/** Minimal surface the tagger needs; the browser Flare and any subclass satisfy it structurally. */
export interface SdkTaggable {
    setSdkInfo(info: SdkInfo): unknown;
    setFramework(framework: Framework): unknown;
}

/**
 * Builds a per-package SDK/framework identity tagger. Holds its own WeakSet guards so each Flare
 * instance (singleton or injected renderer) is tagged at most once, on each of the two axes.
 */
/**
 * `frameworkName` is typed as `FrameworkName`, not `string`: this is the wire vocabulary the backend
 * keys off, so a first-party package cannot invent a value here. A host app that genuinely needs its
 * own name calls `setFramework` directly.
 */
export function createIdentityTagger(config: { sdkName: string; sdkVersion: string; frameworkName: FrameworkName }): {
    registerSdkIdentity(flare: SdkTaggable): void;
    tagFramework(flare: SdkTaggable, frameworkVersion?: string): void;
} {
    const sdkTagged = new WeakSet<object>();
    const frameworkTagged = new WeakSet<object>();

    return {
        registerSdkIdentity(flare) {
            if (sdkTagged.has(flare)) return;
            sdkTagged.add(flare);
            flare.setSdkInfo({ name: config.sdkName, version: config.sdkVersion });
        },
        tagFramework(flare, frameworkVersion) {
            if (frameworkTagged.has(flare)) return;
            frameworkTagged.add(flare);
            flare.setFramework(
                frameworkVersion === undefined
                    ? { name: config.frameworkName }
                    : { name: config.frameworkName, version: frameworkVersion },
            );
        },
    };
}
