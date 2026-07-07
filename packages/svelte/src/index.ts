import { flare } from '@flareapp/js';

import { registerSvelteSdkIdentity } from './identify.js';
import { registerDefaultFlare } from './resolveFlare.js';

// Web entry. Importing @flareapp/js runs the root's side effects (window.flare + global catch),
// correct for the web. Registering the singleton and its SDK identity at import time is a hard
// contract: @flareapp/sveltekit `export * from '@flareapp/svelte'` and overrides the SDK name
// per-report, relying on this running first (spec Decision 6). Do not defer it.
registerDefaultFlare(() => flare);
registerSvelteSdkIdentity(flare);

export { default as FlareErrorBoundary } from './FlareErrorBoundary.svelte';

export { createFlareErrorHandler, type FlareErrorHandlerOptions } from './createFlareErrorHandler.js';

export { __flareRegisterComponent, getComponentTreeContext } from './componentTree.js';

export { withFlareConfig, type WithFlareConfigOptions } from './config.js';

export { flarePreprocessor, type FlarePreprocessorOptions } from './preprocessor.js';

export type { FlareSvelteContext, SvelteErrorOrigin } from './types.js';
