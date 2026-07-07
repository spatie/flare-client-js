import type { AnyValue, AttributeValue, Attributes, KeyValue } from '../types';

/**
 * `inPath` tracks ancestors on the current branch only (added on enter, removed on exit), mirroring
 * flatJsonStringify's decycle. A global "seen" set would mis-flag an object referenced twice in sibling branches.
 */
export function valueToOpenTelemetry(value: AttributeValue, inPath: WeakSet<object> = new WeakSet()): AnyValue | null {
    if (typeof value === 'string') return { stringValue: value };
    if (typeof value === 'boolean') return { boolValue: value };
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) return null;
        return Number.isInteger(value) ? { intValue: value } : { doubleValue: value };
    }
    if (value === null || value === undefined) return null;

    if (Array.isArray(value)) {
        if (inPath.has(value)) return { stringValue: '[Circular]' };
        inPath.add(value);
        const values: AnyValue[] = [];
        for (const item of value) {
            const mapped = valueToOpenTelemetry(item, inPath);
            if (mapped !== null) values.push(mapped);
        }
        inPath.delete(value);
        return { arrayValue: { values } };
    }

    if (typeof value === 'object') {
        if (inPath.has(value)) return { stringValue: '[Circular]' };
        inPath.add(value);
        const values: KeyValue[] = [];
        for (const [key, item] of Object.entries(value)) {
            const mapped = valueToOpenTelemetry(item as AttributeValue, inPath);
            if (mapped !== null) values.push({ key, value: mapped });
        }
        inPath.delete(value);
        return { kvlistValue: { values } };
    }

    return null;
}

export function attributesToOpenTelemetry(attributes: Attributes): KeyValue[] {
    const out: KeyValue[] = [];
    for (const [key, value] of Object.entries(attributes)) {
        const mapped = valueToOpenTelemetry(value);
        if (mapped !== null) out.push({ key, value: mapped });
    }
    return out;
}
