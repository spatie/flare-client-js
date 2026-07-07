import { flare } from '@flareapp/js';

import { registerDefaultFlare } from './resolveFlare';

// Web entry: the js-root singleton is the default Flare for no-prop/no-option usage. Importing
// @flareapp/js here also runs the root's own side effects (window.flare + global catch), correct for
// the web. Identity is set at install/setup time (needs app.version), not here.
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
