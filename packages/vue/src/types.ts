import type { Flare } from '@flareapp/js/browser';
import type { ComponentPublicInstance } from 'vue';

import type { ProfileComponentsOption } from './profileVueComponents';

export type ErrorOrigin = 'setup' | 'render' | 'lifecycle' | 'event' | 'watcher' | 'unknown';

export type ComponentHierarchyFrame = {
    component: string;
    file: string | null;
    props?: Record<string, unknown>;
};

export type RouteParamValue = string | string[];

export type RouteQueryValue = string | null;

export type RouteContext = {
    name: string | null;
    path: string;
    fullPath: string;
    params: Record<string, RouteParamValue>;
    query: Record<string, RouteQueryValue | RouteQueryValue[]>;
    hash: string;
    matched: string[];
};

export type FlareVueContext = {
    vue: {
        info: string;
        errorOrigin: ErrorOrigin;
        componentName: string;
        componentProps?: Record<string, unknown>;
        componentHierarchy: string[];
        componentHierarchyFrames: ComponentHierarchyFrame[];
        route?: RouteContext;
    };
};

export type FlareVueWarningContext = {
    vue: {
        type: 'warning';
        info: string;
        componentName: string;
        componentTrace: string;
        route?: RouteContext;
    };
};

export type FlareErrorBoundaryHookParams = {
    error: Error;
    instance: ComponentPublicInstance | null;
    info: string;
};

export type FlareVueOptions = {
    flare?: Flare;
    /** A vue-router Router instance. When set, enables navigation/pageload performance tracing. */
    router?: unknown;
    /**
     * Records a span per component mount. An array matches component names exactly (string) or by
     * `test()` (RegExp). `true` profiles every named component — useful for debugging, but a real
     * page will hit `maxSpansPerTrace` and bury the useful spans. Requires `enableTracing`.
     */
    profileComponents?: ProfileComponentsOption;
    captureWarnings?: boolean;
    attachProps?: boolean;
    propsMaxDepth?: number;
    propsDenylist?: RegExp;
    replaceDefaultDenylist?: boolean;
    beforeEvaluate?: (params: FlareErrorBoundaryHookParams) => void;
    beforeSubmit?: (params: FlareErrorBoundaryHookParams & { context: FlareVueContext }) => FlareVueContext;
    afterSubmit?: (params: FlareErrorBoundaryHookParams & { context: FlareVueContext }) => void;
};

export type FlareErrorBoundaryFallbackProps = {
    error: Error;
    componentProps?: Record<string, unknown>;
    componentHierarchy: string[];
    componentHierarchyFrames: ComponentHierarchyFrame[];
    resetErrorBoundary: () => void;
};
