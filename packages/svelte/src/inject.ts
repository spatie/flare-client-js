// Electron-safe entry. NO @flareapp/js root import, NO default registration, NO import-time
// identity. The caller MUST pass `flare` (handler option / boundary prop); resolveFlare throws
// at wiring time if absent.
export { default as FlareErrorBoundary } from './FlareErrorBoundary.svelte';

export { createFlareErrorHandler, type FlareErrorHandlerOptions } from './createFlareErrorHandler.js';

export { __flareRegisterComponent, getComponentTreeContext } from './componentTree.js';

export { withFlareConfig, type WithFlareConfigOptions } from './config.js';

export { flarePreprocessor, type FlarePreprocessorOptions } from './preprocessor.js';

export type { FlareSvelteContext, SvelteErrorOrigin } from './types.js';
