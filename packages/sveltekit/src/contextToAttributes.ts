import type { AttributeValue, Attributes } from '@flareapp/js';
import { toCustomContext } from '@flareapp/js';

import type { FlareSvelteKitContext } from './types.js';

export function contextToAttributes(context: FlareSvelteKitContext): Attributes {
    return toCustomContext('svelte', context.svelte as unknown as AttributeValue);
}
