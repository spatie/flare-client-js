import { registerSvelteSdkIdentity } from './identify';

registerSvelteSdkIdentity();

export { default as FlareErrorBoundary } from './FlareErrorBoundary.svelte';

export { createFlareErrorHandler, type FlareErrorHandlerOptions } from './createFlareErrorHandler';

export { serializeProps } from './serializeProps';

export { DEFAULT_PROPS_DENYLIST, resolveDenylist } from './constants';

export type { FlareSvelteContext, SvelteErrorOrigin } from './types';
