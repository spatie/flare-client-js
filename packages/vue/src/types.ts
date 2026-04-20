import type { ComponentPublicInstance } from 'vue';

export type ErrorOrigin = 'setup' | 'render' | 'lifecycle' | 'event' | 'watcher' | 'unknown';

export type ComponentHierarchyFrame = {
    component: string;
    file: string | null;
    props?: Record<string, unknown>;
};

export type RouteContext = {
    name: string | null;
    path: string;
    fullPath: string;
    params: Record<string, unknown>;
    query: Record<string, unknown>;
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
    captureWarnings?: boolean;
    attachProps?: boolean;
    propsMaxDepth?: number;
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
