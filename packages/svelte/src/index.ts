import { registerSvelteSdkIdentity } from './identify.js';

registerSvelteSdkIdentity();

export { default as FlareErrorBoundary } from './FlareErrorBoundary.svelte';

export { createFlareErrorHandler, type FlareErrorHandlerOptions } from './createFlareErrorHandler.js';

export { __flareRegisterComponent, getComponentTreeContext } from './componentTree.js';

export { withFlareConfig, type WithFlareConfigOptions } from './config.js';

export { flarePreprocessor, type FlarePreprocessorOptions } from './preprocessor.js';

export type { FlareSvelteContext, SvelteErrorOrigin } from './types.js';
