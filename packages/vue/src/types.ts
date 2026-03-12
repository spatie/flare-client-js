export type FlareVueContext = {
    vue: {
        info: string;
        componentName: string;
        componentHierarchy: string[];
    };
};

export type FlareErrorBoundaryFallbackProps = {
    error: Error;
    componentHierarchy: string[];
    resetErrorBoundary: () => void;
};
