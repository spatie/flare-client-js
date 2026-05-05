import {
    DEFAULT_PROPS_DENYLIST,
    MAX_PROP_ARRAY_LENGTH,
    MAX_PROP_OBJECT_KEYS,
    MAX_PROP_STRING_LENGTH,
} from './constants';

// Produces a JSON-safe, redacted, size-bounded copy of a Vue component's props for the report
// payload. Goals: (1) never crash on cycles or exotic values, (2) never include secrets matched
// by `denylist`, (3) keep the payload small even when components hold large or deep state trees.
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
        const out: unknown[] = slice.map((item) => serialize(item, depth + 1, maxDepth, seen, denylist));

        if (value.length > MAX_PROP_ARRAY_LENGTH) {
            out.push(`[… ${value.length - MAX_PROP_ARRAY_LENGTH} more items]`);
        }

        seen.delete(value);

        return out;
    }

    // Class instances (Date, Map, custom classes, Vue refs/proxies) are deliberately not walked:
    // their internals can be huge, contain getters with side effects, or include reactive
    // dependencies we don't want to trigger from inside an error handler.
    if (!isPlainObject(value)) {
        return '[Object]';
    }

    if (depth > maxDepth) {
        return '[Object]';
    }

    seen.add(value);

    const out: Record<string, unknown> = {};
    const keys = Object.keys(value);
    const limitedKeys = keys.length > MAX_PROP_OBJECT_KEYS ? keys.slice(0, MAX_PROP_OBJECT_KEYS) : keys;

    for (const key of limitedKeys) {
        if (denylist.test(key)) {
            out[key] = '[redacted]';
            continue;
        }

        out[key] = serialize(value[key], depth + 1, maxDepth, seen, denylist);
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
