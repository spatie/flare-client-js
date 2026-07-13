import type { AttributeValue, Attributes } from '../types';

/** Wraps a framework payload as the `context.custom` attribute a report expects. */
export function toCustomContext(framework: string, payload: AttributeValue): Attributes {
    return {
        'context.custom': {
            [framework]: payload,
        },
    };
}
