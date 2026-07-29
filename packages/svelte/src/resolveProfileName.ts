/**
 * The name a profiled component reports, and what `profileComponents` matches against.
 *
 * Separate from `extractComponentName`, which feeds error reports and has to keep its bare basenames.
 * Profiling needs the route path too, otherwise every route in a SvelteKit app is just `+page`.
 *
 * @param filename Absolute path as a Svelte preprocessor receives it.
 * @param routesDir Project-relative routes directory, from `kit.files.routes`.
 */
export function resolveProfileName(filename: string, routesDir = 'src/routes'): string {
    const normalized = filename.replace(/\\/g, '/');
    const base = normalized.split('/').pop() ?? normalized;
    const name = base.replace(/\.svelte$/, '');

    // Only route files clash with each other. An ordinary component name is already fine as is.
    if (!name.startsWith('+')) {
        return name;
    }

    // Users can write `./src/routes` or `src/routes/`, both legal, so flatten before searching.
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
 * Index just past the routes directory, or -1 when the path isn't in there. Anchors on the last
 * occurrence, so a project checked out under something like /home/src/routes/ still works.
 */
function routeDirStart(normalized: string, segments: string): number {
    const nested = normalized.lastIndexOf(`/${segments}/`);
    if (nested !== -1) {
        return nested + segments.length + 2;
    }

    const prefix = `${segments}/`;

    return normalized.startsWith(prefix) ? prefix.length : -1;
}
