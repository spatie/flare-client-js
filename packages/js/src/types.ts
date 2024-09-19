export type Config = {
    key: string;
    version: string;
    sourcemapVersion: string;
    stage: string;
    maxGlowsPerReport: number;
    reportingUrl: string;
    debug: boolean;
    beforeEvaluate: (
        error: Error,
    ) => Error | false | null | Promise<Error | false | null>;
    beforeSubmit: (
        report: Report,
    ) => Report | false | null | Promise<Report | false | null>;
};

export type Report = {
    notifier: string;
    exception_class: string;
    seen_at: number;
    message: string;
    language: 'javascript';
    glows: Glow[];
    context: Context;
    stacktrace: StackFrame[];
    sourcemap_version_id: string;
    solutions: Solution[];
    stage?: string;
};

export interface SolutionProviderExtraParameters {}

export type SolutionProvider = {
    canSolve: (
        error: Error,
        extraParameters?: SolutionProviderExtraParameters,
    ) => boolean | Promise<boolean>;
    getSolutions: (
        error: Error,
        extraParameters?: SolutionProviderExtraParameters,
    ) => Solution[] | Promise<Solution[]>;
};

export type Solution = {
    class: string;
    title: string;
    description: string;
    links: { [label: string]: string };
    action_description?: string;
    is_runnable?: boolean;
};

export type Context = {
    request?: {
        url?: String;
        useragent?: String;
        referrer?: String; // TODO: Flare doesn't catch this yet
        readyState?: String; // TODO: Flare doesn't catch this yet
    };
    request_data?: {
        queryString: { [key: string]: string };
    };
    cookies?: { [key: string]: string };
    [key: string]: any;
};

export type StackFrame = {
    line_number: number;
    column_number: number; // TODO: Flare doesn't catch this yet
    method: string;
    file: string;
    code_snippet: { [key: number]: string };
    trimmed_column_number: number | null;
    class: string;
};

export type Glow = {
    time: number;
    microtime: number;
    name: String;
    message_level: MessageLevel;
    meta_data: object | object[];
};

export type MessageLevel = 'info' | 'debug' | 'warning' | 'error' | 'critical';
