import { safeClone } from '@flareapp/core';

import {
    DEFAULT_PROPS_DENYLIST,
    MAX_PROP_ARRAY_LENGTH,
    MAX_PROP_OBJECT_KEYS,
    MAX_PROP_STRING_LENGTH,
} from './constants';

/**
 * JSON-safe, redacted, size-bounded copy of a Vue component's props for the report payload. Delegates
 * to core safeClone (display mode) so the cycle / BigInt / throwing-getter safety is shared with core.
 */
export function serializeProps(
    value: Record<string, unknown>,
    maxDepth: number,
    denylist: RegExp = DEFAULT_PROPS_DENYLIST,
): Record<string, unknown> {
    return safeClone(value, {
        mode: 'display',
        maxDepth,
        arrayCap: MAX_PROP_ARRAY_LENGTH,
        objectKeyCap: MAX_PROP_OBJECT_KEYS,
        stringCap: MAX_PROP_STRING_LENGTH,
        denylist,
    }) as Record<string, unknown>;
}
