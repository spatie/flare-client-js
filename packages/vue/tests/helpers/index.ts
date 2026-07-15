import type { Attributes } from '@flareapp/js';
import type { Mock } from 'vitest';
import type { ComponentPublicInstance } from 'vue';

import type { FlareVueContext } from '../../src/types';

/**
 * Fake Vue `ComponentPublicInstance`. `name` sets `$options.__name` (the SFC-compiler-assigned name);
 * `overrides.name` sets the legacy `$options.name` fallback field independently, so both fallback
 * paths in `getComponentName` can be exercised on their own. `parent` defaults to null, `props`
 * defaults to `{}`.
 */
export function createMockInstance(
    name?: string,
    overrides: {
        parent?: ComponentPublicInstance | null;
        props?: Record<string, unknown>;
        file?: string;
        name?: string;
    } = {},
): ComponentPublicInstance {
    const { parent = null, props, file, name: fallbackName } = overrides;

    return {
        $options: {
            ...(name !== undefined ? { __name: name } : {}),
            ...(fallbackName !== undefined ? { name: fallbackName } : {}),
            ...(file !== undefined ? { __file: file } : {}),
        },
        $parent: parent,
        $props: props ?? {},
    } as unknown as ComponentPublicInstance;
}

export function createMockRouter(route: Record<string, unknown>) {
    return { currentRoute: { value: route } };
}

/** Reads the `context.custom.vue` payload flare's report mock was called with. */
export function getReportedVue(mockReport: Mock, i = 0): FlareVueContext['vue'] {
    const custom = ((mockReport.mock.calls[i] ?? [])[1] as Attributes)['context.custom'] as Record<string, unknown>;
    return custom?.vue as FlareVueContext['vue'];
}
