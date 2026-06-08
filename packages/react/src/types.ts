export type ComponentStackFrame = {
    component: string;
    file: string | null;
    line: number | null;
    column: number | null;
};

export type MinifiedReactError = {
    number: number;
    args: string[];
    url: string | null;
};

export type FlareReactContext = {
    react: {
        componentStack: string[];
        componentStackFrames: ComponentStackFrame[];
        version?: string;
        minifiedError?: MinifiedReactError;
    };
};
