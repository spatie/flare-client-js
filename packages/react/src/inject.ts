// Electron-safe entry. NO @flareapp/js root import, NO default registration, NO
// import-time identity. The caller MUST pass a `flare` instance; resolveFlare
// throws at wiring time if absent.
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
