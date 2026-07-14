export type SafeCloneOptions =
    | { mode: 'json' }
    | {
          mode: 'display';
          maxDepth: number;
          arrayCap: number;
          objectKeyCap: number;
          stringCap: number;
          denylist: RegExp;
      };

/**
 * One JSON-safe recursive clone shared by flatJsonStringify (json mode) and vue serializeProps
 * (display mode). Cycles become "[Circular]", a BigInt its decimal string, and a throwing getter
 * "[Getter threw]" in both modes. json mode passes functions / symbols / non-plain objects through
 * (so JSON.stringify still drops functions and calls Date.toJSON); display mode replaces them with
 * placeholders and applies the depth / array / key / string caps and the key denylist.
 */
export function safeClone(value: unknown, options: SafeCloneOptions): unknown {
    const seen = new WeakSet<object>();

    function walk(node: unknown, depth: number): unknown {
        if (node === null) return null;

        const type = typeof node;

        if (type === 'bigint') return (node as bigint).toString();
        if (type === 'function') return options.mode === 'display' ? '[Function]' : node;
        if (type === 'symbol') return options.mode === 'display' ? '[Symbol]' : node;
        if (type === 'string') return options.mode === 'display' ? truncate(node as string, options.stringCap) : node;
        if (type !== 'object') return node;

        if (seen.has(node as object)) return '[Circular]';

        if (Array.isArray(node)) {
            if (options.mode === 'display' && depth > options.maxDepth) return '[Array]';
            seen.add(node);
            const cap = options.mode === 'display' ? options.arrayCap : Infinity;
            const slice = node.length > cap ? node.slice(0, cap) : node;
            const result: unknown[] = slice.map((item) => walk(item, depth + 1));
            if (node.length > cap) result.push(`[… ${node.length - cap} more items]`);
            seen.delete(node);
            return result;
        }

        if (!isPlainObject(node)) return options.mode === 'display' ? '[Object]' : node;

        if (options.mode === 'display' && depth > options.maxDepth) return '[Object]';

        seen.add(node);
        const result: Record<string, unknown> = {};
        const keys = Object.keys(node);
        const keyCap = options.mode === 'display' ? options.objectKeyCap : Infinity;
        const limitedKeys = keys.length > keyCap ? keys.slice(0, keyCap) : keys;
        for (const key of limitedKeys) {
            if (options.mode === 'display' && options.denylist.test(key)) {
                result[key] = '[redacted]';
                continue;
            }
            try {
                result[key] = walk(node[key], depth + 1);
            } catch {
                result[key] = '[Getter threw]';
            }
        }
        if (keys.length > keyCap) result['…'] = `[${keys.length - keyCap} more keys]`;
        seen.delete(node);
        return result;
    }

    return walk(value, 0);
}

function truncate(value: string, max: number): string {
    if (value.length <= max) return value;
    return `${value.slice(0, max)}…[truncated ${value.length - max} chars]`;
}

/**
 * Literal object / null prototypes only. Class instances may have side-effecting getters or
 * non-enumerable internals we should not traverse, so they are left to the caller's mode policy.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== 'object') return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}
