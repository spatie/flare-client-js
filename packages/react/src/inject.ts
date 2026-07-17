// Electron-safe entry: no @flareapp/js root import, no default registration, no import-time
// identity. The caller must pass a `flare` instance; resolveFlare throws at wiring time if absent.
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
