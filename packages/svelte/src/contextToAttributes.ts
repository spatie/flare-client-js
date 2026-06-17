import type { AttributeValue, Attributes } from '@flareapp/core';

import type { FlareSvelteContext } from './types.js';

export function contextToAttributes(context: FlareSvelteContext): Attributes {
    return {
        'context.custom': {
            svelte: context.svelte as unknown as AttributeValue,
        },
    };
}
