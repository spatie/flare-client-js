// Electron-safe entry: no @flareapp/js root import, no default registration. The caller must pass
// `flare` (plugin option / boundary prop); resolveFlare throws at wiring time if absent.
export { FlareErrorBoundary } from './FlareErrorBoundary';
export { flareVue } from './flareVue';
export { DEFAULT_PROPS_DENYLIST } from './constants';
export type {
    ComponentHierarchyFrame,
    ErrorOrigin,
    FlareErrorBoundaryFallbackProps,
    FlareErrorBoundaryHookParams,
    FlareVueContext,
    FlareVueOptions,
    FlareVueWarningContext,
    RouteContext,
    RouteParamValue,
    RouteQueryValue,
} from './types';
