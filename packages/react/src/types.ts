export type ComponentStackFrame = {
    component: string;
    file: string | null;
    line: number | null;
    column: number | null;
};

export type FlareReactContext = {
    react: {
        componentStack: string[];
        componentStackFrames: ComponentStackFrame[];
    };
};
