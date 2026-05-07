import { registerReactSdkIdentity } from './identify';

registerReactSdkIdentity();

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

export type { ComponentStackFrame, FlareReactContext } from './types';
