export function serializeProps(value: Record<string, unknown>, maxDepth: number): Record<string, unknown> {
    const seen = new WeakSet<object>();

    return serializeObject(value, 0, maxDepth, seen);
}

function serializeValue(value: unknown, depth: number, maxDepth: number, seen: WeakSet<object>): unknown {
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
        const out = value.map((item) => serializeValue(item, depth + 1, maxDepth, seen));
        seen.delete(value);

        return out;
    }

    if (!isPlainObject(value)) {
        return '[Object]';
    }

    if (depth > maxDepth) {
        return '[Object]';
    }

    return serializeObject(value as Record<string, unknown>, depth, maxDepth, seen);
}

function serializeObject(
    value: Record<string, unknown>,
    depth: number,
    maxDepth: number,
    seen: WeakSet<object>
): Record<string, unknown> {
    seen.add(value);

    const out: Record<string, unknown> = {};

    for (const key of Object.keys(value)) {
        out[key] = serializeValue(value[key], depth + 1, maxDepth, seen);
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
