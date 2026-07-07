/**
 * JSON.stringify but cycle-safe. User glow data / addContext values can contain cycles (Vue/React component
 * instances), so back-edges are replaced with "[Circular]" before serialising.
 */
export function flatJsonStringify(json: object): string {
    return JSON.stringify(decycle(json));
}

// Literal object/null prototypes only: class instances may have side-effecting getters or non-enumerable internals we
// should not traverse. Those are left to JSON.stringify (typically toJSON or {}).
function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

function decycle(root: unknown): unknown {
    // `inPath` tracks ancestors on the current branch only (added on enter, removed on exit). A global "seen" set would
    // mis-flag an object referenced twice in different branches as circular.
    const inPath = new WeakSet<object>();

    function clone(node: unknown): unknown {
        if (Array.isArray(node)) {
            if (inPath.has(node)) return '[Circular]';
            inPath.add(node);
            const result = node.map(clone);
            inPath.delete(node);
            return result;
        }
        if (isPlainObject(node)) {
            if (inPath.has(node)) return '[Circular]';
            inPath.add(node);
            const result: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(node)) {
                result[k] = clone(v);
            }
            inPath.delete(node);
            return result;
        }
        return node;
    }

    return clone(root);
}
