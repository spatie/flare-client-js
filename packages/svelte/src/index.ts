import { flare } from '@flareapp/js';

import { registerSvelteSdkIdentity } from './identify.js';
import { registerDefaultFlare } from './resolveFlare.js';

// Web entry. Importing @flareapp/js runs the root's own side effects (window.flare + global
// catch) — correct for the web. Register the singleton as the default Flare AND set its SDK
// identity AT IMPORT. The import-time identity registration is a hard contract: @flareapp/sveltekit
// does `export * from '@flareapp/svelte'` and overrides the SDK name per-report, relying on this
// running first (spec Decision 6). Do not defer it.
registerDefaultFlare(() => flare);
registerSvelteSdkIdentity(flare);

export { default as FlareErrorBoundary } from './FlareErrorBoundary.svelte';

export { createFlareErrorHandler, type FlareErrorHandlerOptions } from './createFlareErrorHandler.js';

export { __flareRegisterComponent, getComponentTreeContext } from './componentTree.js';

export { withFlareConfig, type WithFlareConfigOptions } from './config.js';

export { flarePreprocessor, type FlarePreprocessorOptions } from './preprocessor.js';

export type { FlareSvelteContext, SvelteErrorOrigin } from './types.js';
