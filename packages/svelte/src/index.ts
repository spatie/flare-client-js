import { registerSvelteSdkIdentity } from './identify.js';

registerSvelteSdkIdentity();

export { default as FlareErrorBoundary } from './FlareErrorBoundary.svelte';

export { createFlareErrorHandler, type FlareErrorHandlerOptions } from './createFlareErrorHandler.js';

export { __flareRegisterComponent } from './componentTree.js';

export { flarePreprocessor, type FlarePreprocessorOptions } from './preprocessor.js';

export type { FlareSvelteContext, SvelteErrorOrigin } from './types.js';
