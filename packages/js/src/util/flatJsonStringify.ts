export function flatJsonStringify(json: object): string {
    const ancestors = new WeakSet<object>();
    const path: object[] = [];

    return JSON.stringify(json, function (this: object, _key, value) {
        if (typeof value !== 'object' || value === null) {
            return value;
        }

        // Pop ancestors that are no longer on the path to `this`.
        while (path.length > 0 && path[path.length - 1] !== this) {
            const popped = path.pop()!;
            ancestors.delete(popped);
        }

        if (ancestors.has(value)) {
            return '[Circular]';
        }

        ancestors.add(value);
        path.push(value);

        return value;
    });
}
