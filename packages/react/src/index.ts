import { flare } from '@flareapp/js';

import { registerReactSdkIdentity } from './identify';
import { registerDefaultFlare } from './resolveFlare';

// Web entry: the js-root singleton is both the default Flare (no-prop usage) and the identity target.
// Importing @flareapp/js here also triggers its own side effects (window.flare + global catch).
registerDefaultFlare(() => flare);
registerReactSdkIdentity(flare);

export {
    FlareErrorBoundary,
    type FlareErrorBoundaryProps,
    type FlareErrorBoundaryFallbackProps,
} from './FlareErrorBoundary';

export {
    flareReactErrorHandler,
    type FlareReactErrorHandlerCallback,
    type FlareReactErrorHandlerOptions,
} from './flareReactErrorHandler';

export type { ComponentStackFrame, FlareReactContext, MinifiedReactError } from './types';
