import { DEFAULT_PROPS_DENYLIST } from './constants';

export function serializeProps(
    value: Record<string, unknown>,
    maxDepth: number,
    denylist: RegExp = DEFAULT_PROPS_DENYLIST
): Record<string, unknown> {
    return serialize(value, 0, maxDepth, new WeakSet(), denylist) as Record<string, unknown>;
}

function serialize(value: unknown, depth: number, maxDepth: number, seen: WeakSet<object>, denylist: RegExp): unknown {
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

        const out = value.map((item) => serialize(item, depth + 1, maxDepth, seen, denylist));

        seen.delete(value);

        return out;
    }

    if (!isPlainObject(value)) {
        return '[Object]';
    }

    if (depth > maxDepth) {
        return '[Object]';
    }

    seen.add(value);

    const out: Record<string, unknown> = {};

    for (const key of Object.keys(value)) {
        if (denylist.test(key)) {
            out[key] = '[Redacted]';
            continue;
        }

        out[key] = serialize(value[key], depth + 1, maxDepth, seen, denylist);
    }

    seen.delete(value);

    return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== 'object') {
        return false;
    }

    const prototype = Object.getPrototypeOf(value);

    return prototype === null || prototype === Object.prototype;
}
