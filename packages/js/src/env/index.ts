declare const FLARE_JS_KEY: string | undefined;
declare const FLARE_SOURCEMAP_VERSION: string | undefined;

// Injected during build
export const CLIENT_VERSION =
    typeof process.env.FLARE_JS_CLIENT_VERSION === 'undefined' ? '?' : process.env.FLARE_JS_CLIENT_VERSION;

// Injected by flare-vite-plugin-sourcemap-uploader (optional)
export const KEY = typeof FLARE_JS_KEY === 'undefined' ? '' : FLARE_JS_KEY;

// Injected by flare-vite-plugin-sourcemap-uploader (optional)
export const SOURCEMAP_VERSION = typeof FLARE_SOURCEMAP_VERSION === 'undefined' ? '' : FLARE_SOURCEMAP_VERSION;
