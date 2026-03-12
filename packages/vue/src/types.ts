import type { ComponentPublicInstance } from 'vue';

export type FlareVueContext = {
    vue: {
        info: string;
        componentName: string;
        componentHierarchy: string[];
    };
};

export type FlareErrorBoundaryHookParams = {
    error: Error;
    instance: ComponentPublicInstance | null;
    info: string;
};

export type FlareErrorBoundaryFallbackProps = {
    error: Error;
    componentHierarchy: string[];
    resetErrorBoundary: () => void;
};
