export function flatJsonStringify(json: object): string {
    return JSON.stringify(decycle(json));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

function decycle(root: unknown): unknown {
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
