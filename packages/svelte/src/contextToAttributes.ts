import type { AttributeValue, Attributes } from '@flareapp/js';

import type { FlareSvelteContext } from './types';

export function contextToAttributes(context: FlareSvelteContext): Attributes {
    return {
        'context.custom': {
            framework: 'svelte',
            svelte: context.svelte as unknown as AttributeValue,
        },
    };
}
