import type { ComponentPublicInstance } from 'vue';

export type ErrorOrigin = 'setup' | 'render' | 'lifecycle' | 'event' | 'watcher' | 'unknown';

export type ComponentHierarchyFrame = {
    component: string;
    file: string | null;
    props: Record<string, unknown> | null;
};

export type FlareVueContext = {
    vue: {
        info: string;
        errorOrigin: ErrorOrigin;
        componentName: string;
        componentProps: Record<string, unknown> | null;
        componentHierarchy: string[];
        componentHierarchyFrames: ComponentHierarchyFrame[];
    };
};

export type FlareErrorBoundaryHookParams = {
    error: Error;
    instance: ComponentPublicInstance | null;
    info: string;
};

export type FlareVueOptions = {
    captureWarnings?: boolean;
    beforeEvaluate?: (params: FlareErrorBoundaryHookParams) => void;
    beforeSubmit?: (params: FlareErrorBoundaryHookParams & { context: FlareVueContext }) => FlareVueContext;
    afterSubmit?: (params: FlareErrorBoundaryHookParams & { context: FlareVueContext }) => void;
};

export type FlareErrorBoundaryFallbackProps = {
    error: Error;
    componentProps: Record<string, unknown> | null;
    componentHierarchy: string[];
    componentHierarchyFrames: ComponentHierarchyFrame[];
    resetErrorBoundary: () => void;
};
