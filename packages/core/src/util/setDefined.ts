import type { AttributeValue, Attributes } from '../types';

/** Assign the value only when it is neither undefined nor null. */
export function setDefined(target: Attributes, key: string, value: AttributeValue | undefined): void {
    if (value !== undefined && value !== null) {
        target[key] = value;
    }
}
