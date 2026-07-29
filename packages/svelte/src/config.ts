import type { ProfileComponentsOption } from '@flareapp/core/util';
import type { PreprocessorGroup } from 'svelte/compiler';

import { flarePreprocessor, type FlarePreprocessorOptions } from './preprocessor.js';

interface SvelteConfig {
    preprocess?: PreprocessorGroup | PreprocessorGroup[];
    kit?: { files?: { routes?: string }; [key: string]: unknown };
    [key: string]: unknown;
}

interface FlarePreprocessorGroupWithId extends PreprocessorGroup {
    /** Prevents double-injection when withFlareConfig wraps a config that already has the preprocessor. */
    __flareId?: boolean;
}

export interface WithFlareConfigOptions {
    componentTracking?: boolean;
    /** Which components get a mount span. Matched against the route-aware profile name. */
    profileComponents?: ProfileComponentsOption;
    exclude?: FlarePreprocessorOptions['exclude'];
    importSource?: string;
}

export function withFlareConfig(config: SvelteConfig, options?: WithFlareConfigOptions): SvelteConfig {
    const { componentTracking = true, profileComponents = false, exclude, importSource } = options ?? {};

    // An empty array profiles nothing, so it is "off" for the purpose of deciding whether to install.
    const profilingRequested =
        profileComponents === true || (Array.isArray(profileComponents) && profileComponents.length > 0);

    if (!componentTracking && !profilingRequested) {
        return config;
    }

    const existing = normalizePreprocessors(config.preprocess);

    if (existing.some((p) => !!(p as FlarePreprocessorGroupWithId).__flareId)) {
        return config;
    }

    const preprocessor = flarePreprocessor({
        exclude,
        importSource,
        componentTracking,
        profileComponents,
        routesDir: config.kit?.files?.routes,
    }) as FlarePreprocessorGroupWithId;
    preprocessor.__flareId = true;

    return {
        ...config,
        preprocess: [preprocessor, ...existing],
    };
}

function normalizePreprocessors(preprocess: SvelteConfig['preprocess']): PreprocessorGroup[] {
    if (!preprocess) {
        return [];
    }
    if (Array.isArray(preprocess)) {
        return preprocess;
    }
    return [preprocess];
}

export { flarePreprocessor, type FlarePreprocessorOptions } from './preprocessor.js';
