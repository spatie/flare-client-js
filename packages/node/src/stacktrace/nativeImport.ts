/**
 * Indirection around dynamic `import()` that hides the imported specifier
 * from static analyzers.
 *
 * Why this exists: `import('node:fs/promises')` written directly in source is
 * picked up by bundlers (webpack, esbuild, rollup, tsdown) at build time. If
 * a downstream consumer accidentally bundles `@flareapp/node` into a target
 * that does not understand `node:` specifiers (a renderer process, a
 * browser-only build, an Edge runtime, etc), the build fails with
 * `Module not found: node:fs/promises` even though the call is never reached
 * at runtime in that environment.
 *
 * Constructing the `import` callsite via `new Function('id', 'return import(id)')`
 * keeps the specifier as a runtime argument. Bundlers cannot statically know
 * what string will be passed, so they leave it alone. The function is then
 * called only on the Node code paths (`DiskFileReader`) where `node:`
 * specifiers actually resolve.
 *
 * Cast at the boundary so the rest of the code can use a typed `nativeImport`
 * without sprinkling `any` around.
 */
export const nativeImport = new Function('id', 'return import(id)') as <T = unknown>(id: string) => Promise<T>;
