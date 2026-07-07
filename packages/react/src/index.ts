import { flare } from '@flareapp/js';

import { registerReactSdkIdentity } from './identify';
import { registerDefaultFlare } from './resolveFlare';

// Web entry side effects: the js-root singleton is both the default Flare for no-prop usage and the
// identity target. Importing @flareapp/js here also runs the root's own side effects (window.flare +
// global catch), which is correct for the web.
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
