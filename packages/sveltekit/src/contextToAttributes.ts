import type { AttributeValue, Attributes } from '@flareapp/js';

import type { FlareSvelteKitContext } from './types';

export function contextToAttributes(context: FlareSvelteKitContext): Attributes {
    return {
        'context.custom': {
            framework: 'svelte',
            svelte: context.svelte as unknown as AttributeValue,
        },
    };
}
