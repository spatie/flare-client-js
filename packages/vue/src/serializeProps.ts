import {
    DEFAULT_PROPS_DENYLIST,
    MAX_PROP_ARRAY_LENGTH,
    MAX_PROP_OBJECT_KEYS,
    MAX_PROP_STRING_LENGTH,
} from './constants';

export function serializeProps(
    value: Record<string, unknown>,
    maxDepth: number,
    denylist: RegExp = DEFAULT_PROPS_DENYLIST
): Record<string, unknown> {
    const seen = new WeakSet<object>();

    return serializeObject(value, 0, maxDepth, seen, denylist);
}

function serializeValue(
    value: unknown,
    depth: number,
    maxDepth: number,
    seen: WeakSet<object>,
    denylist: RegExp
): unknown {
    if (value === null) {
        return null;
    }

    const type = typeof value;

    if (type === 'function') {
        return '[Function]';
    }

    if (type === 'symbol') {
        return '[Symbol]';
    }

    if (type === 'bigint') {
        return (value as bigint).toString();
    }

    if (type === 'string') {
        return truncateString(value as string);
    }

    if (type !== 'object') {
        return value;
    }

    if (seen.has(value as object)) {
        return '[Circular]';
    }

    if (Array.isArray(value)) {
        if (depth > maxDepth) {
            return '[Array]';
        }

        seen.add(value);

        const slice = value.length > MAX_PROP_ARRAY_LENGTH ? value.slice(0, MAX_PROP_ARRAY_LENGTH) : value;
        const out: unknown[] = slice.map((item) => serializeValue(item, depth + 1, maxDepth, seen, denylist));

        if (value.length > MAX_PROP_ARRAY_LENGTH) {
            out.push(`[… ${value.length - MAX_PROP_ARRAY_LENGTH} more items]`);
        }

        seen.delete(value);

        return out;
    }

    if (!isPlainObject(value)) {
        return '[Object]';
    }

    if (depth > maxDepth) {
        return '[Object]';
    }

    return serializeObject(value as Record<string, unknown>, depth, maxDepth, seen, denylist);
}

function serializeObject(
    value: Record<string, unknown>,
    depth: number,
    maxDepth: number,
    seen: WeakSet<object>,
    denylist: RegExp
): Record<string, unknown> {
    seen.add(value);

    const out: Record<string, unknown> = {};
    const keys = Object.keys(value);
    const limitedKeys = keys.length > MAX_PROP_OBJECT_KEYS ? keys.slice(0, MAX_PROP_OBJECT_KEYS) : keys;

    for (const key of limitedKeys) {
        if (denylist.test(key)) {
            out[key] = '[Redacted]';
            continue;
        }

        out[key] = serializeValue(value[key], depth + 1, maxDepth, seen, denylist);
    }

    if (keys.length > MAX_PROP_OBJECT_KEYS) {
        out['…'] = `[${keys.length - MAX_PROP_OBJECT_KEYS} more keys]`;
    }

    seen.delete(value);

    return out;
}

function truncateString(value: string): string {
    if (value.length <= MAX_PROP_STRING_LENGTH) {
        return value;
    }

    return `${value.slice(0, MAX_PROP_STRING_LENGTH)}…[truncated ${value.length - MAX_PROP_STRING_LENGTH} chars]`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== 'object') {
        return false;
    }

    const prototype = Object.getPrototypeOf(value);

    return prototype === null || prototype === Object.prototype;
}
