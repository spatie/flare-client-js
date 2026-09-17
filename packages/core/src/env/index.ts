declare const FLARE_JS_KEY: string | undefined;
declare const FLARE_SOURCEMAP_VERSION: string | undefined;

// tsdown inlines the member access at build time. A `typeof process` guard or a local `process`
// declaration survives the build and reads '?' in browsers. Under vitest it reads '?'.
export const CLIENT_VERSION: string = process.env.FLARE_JS_CLIENT_VERSION ?? '?';

// Injected by flare-vite-plugin-sourcemap-uploader (optional)
export const KEY = typeof FLARE_JS_KEY === 'undefined' ? '' : FLARE_JS_KEY;

// Injected by flare-vite-plugin-sourcemap-uploader (optional)
export const SOURCEMAP_VERSION = typeof FLARE_SOURCEMAP_VERSION === 'undefined' ? '' : FLARE_SOURCEMAP_VERSION;
