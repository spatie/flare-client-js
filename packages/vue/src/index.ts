import { flare } from '@flareapp/js';

import { registerDefaultFlare } from './resolveFlare';

// Web entry: the js-root singleton is the default Flare when no flare prop/option is passed.
// Importing @flareapp/js here also triggers its side effects (window.flare + global catch).
// Identity is set at install/setup time instead, since that needs app.version.
registerDefaultFlare(() => flare);

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
