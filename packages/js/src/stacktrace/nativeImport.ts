// A dynamic import that bundlers cannot statically analyse. Passing `node:` specifiers to a normal
// `import('node:...')` (even with @vite-ignore) makes browser bundles emit "externalized for browser
// compatibility" warnings and webpack throw UnhandledSchemeError. Routing the specifier through a
// `Function`-built import hides it, so the bundler never sees a `node:` request.
//
// Built lazily and only ever called behind an `isNode()` gate, so the `Function` constructor is never
// evaluated in the browser — keeping it safe under strict CSP.
let cached: ((specifier: string) => Promise<any>) | null = null;

export function nativeImport(specifier: string): Promise<any> {
    if (!cached) {
        cached = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;
    }

    return cached(specifier);
}
