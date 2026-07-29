/**
 * The name a profiled component reports, and the string `profileComponents` is matched against.
 *
 * Deliberately separate from `extractComponentName` in ./preprocessor.ts, which feeds the published
 * error-reporting component tree and must keep emitting bare basenames. Profiling needs more: every
 * SvelteKit route is a `+page.svelte`, so bare basenames would make every route in an app
 * indistinguishable both in the allowlist and in the waterfall.
 *
 * @param filename Absolute path as a Svelte preprocessor receives it.
 * @param routesDir Project-relative routes directory, from `kit.files.routes`.
 */
export function resolveProfileName(filename: string, routesDir = 'src/routes'): string {
    const normalized = filename.replace(/\\/g, '/');
    const base = normalized.split('/').pop() ?? normalized;
    const name = base.replace(/\.svelte$/, '');

    // Only SvelteKit route files collide with each other; an ordinary component name already reads fine.
    if (!name.startsWith('+')) {
        return name;
    }

    // `kit.files.routes` is a user-written string SvelteKit later path.resolve()s, so `./src/routes`
    // and `src/routes/` are both legal. Normalize them to bare segments before searching.
    const segments = routesDir
        .replace(/\\/g, '/')
        .replace(/^\.\//, '')
        .replace(/^\/+|\/+$/g, '');
    const start = routeDirStart(normalized, segments);
    if (start === -1) {
        return name;
    }

    const relativeDir = normalized.slice(start, normalized.lastIndexOf('/'));

    return relativeDir ? `${relativeDir}/${name}` : name;
}

/**
 * Index just past the routes directory inside an absolute path, or -1 when it is not in there.
 * Anchors on the LAST occurrence so a project checked out under a path that itself contains the
 * routes segments still resolves against the real one.
 */
function routeDirStart(normalized: string, segments: string): number {
    const nested = normalized.lastIndexOf(`/${segments}/`);
    if (nested !== -1) {
        return nested + segments.length + 2;
    }

    const prefix = `${segments}/`;

    return normalized.startsWith(prefix) ? prefix.length : -1;
}
