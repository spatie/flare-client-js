// JSON.stringify throws on circular references. User-supplied glow data and addContext values can
// realistically contain cycles (e.g. Vue/React component instances), so we walk the tree first and
// replace any back-edges with the sentinel "[Circular]" before serialising.
export function flatJsonStringify(json: object): string {
    return JSON.stringify(decycle(json));
}

// Restricted to literal object/null prototypes on purpose: class instances may have getters with
// side effects or non-enumerable internals that we shouldn't traverse. They're left to JSON.stringify
// to handle (typically by calling toJSON or returning {}).
function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

function decycle(root: unknown): unknown {
    // `inPath` tracks ancestors on the current branch only (added on enter, removed on exit). Using a
    // global "seen" set would mis-flag the same object referenced twice in different branches as
    // circular, even though no cycle exists.
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
