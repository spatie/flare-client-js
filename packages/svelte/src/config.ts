import type { PreprocessorGroup } from 'svelte/compiler';

import { flarePreprocessor, type FlarePreprocessorOptions } from './preprocessor.js';

interface SvelteConfig {
    preprocess?: PreprocessorGroup | PreprocessorGroup[];
    [key: string]: unknown;
}

interface FlarePreprocessorGroupWithId extends PreprocessorGroup {
    /** Prevents double-injection when withFlareConfig wraps a config that already has the preprocessor. */
    __flareId?: boolean;
}

export interface WithFlareConfigOptions {
    componentTracking?: boolean;
    exclude?: FlarePreprocessorOptions['exclude'];
}

export function withFlareConfig(config: SvelteConfig, options?: WithFlareConfigOptions): SvelteConfig {
    const { componentTracking = true, exclude } = options ?? {};

    if (!componentTracking) {
        return config;
    }

    const existing = normalizePreprocessors(config.preprocess);

    if (existing.some((p) => !!(p as FlarePreprocessorGroupWithId).__flareId)) {
        return config;
    }

    const preprocessor = flarePreprocessor({ exclude }) as FlarePreprocessorGroupWithId;
    preprocessor.__flareId = true;

    return {
        ...config,
        preprocess: [preprocessor, ...existing],
    };
}

function normalizePreprocessors(preprocess: SvelteConfig['preprocess']): PreprocessorGroup[] {
    if (!preprocess) return [];
    if (Array.isArray(preprocess)) return preprocess;
    return [preprocess];
}

export { flarePreprocessor, type FlarePreprocessorOptions } from './preprocessor.js';
