export type MessageLevel = 'debug' | 'info' | 'notice' | 'warning' | 'error' | 'critical' | 'alert' | 'emergency';

export type AttributeValue = string | number | boolean | null | AttributeValue[] | { [key: string]: AttributeValue };

export type Attributes = Record<string, AttributeValue>;

export type Config = {
    key: string | null;
    version: string;
    sourcemapVersionId: string;
    stage: string;
    maxGlowsPerReport: number;
    reportBrowserExtensionErrors: boolean;
    ingestUrl: string;
    debug: boolean;
    urlDenylist: RegExp;
    beforeEvaluate: (error: Error) => Error | false | null | Promise<Error | false | null>;
    beforeSubmit: (report: Report) => Report | false | null | Promise<Report | false | null>;
};

export type StackFrame = {
    file: string;
    lineNumber: number;
    columnNumber?: number;
    method?: string;
    class?: string;
    codeSnippet?: { [line: number]: string };
    isApplicationFrame?: boolean;
    arguments?: unknown[];
};

export type SpanEvent = {
    type: string;
    startTimeUnixNano: number;
    endTimeUnixNano: number | null;
    attributes: Attributes;
};

export type OverriddenGrouping =
    | 'exception_class'
    | 'exception_message'
    | 'exception_message_and_class'
    | 'full_stacktrace_and_exception_class_and_code';

export type Report = {
    exceptionClass?: string | null;
    message?: string | null;
    code?: string;
    seenAtUnixNano: number;
    isLog?: boolean;
    level?: MessageLevel;
    sourcemapVersionId?: string;
    trackingUuid?: string;
    handled?: boolean;
    openFrameIndex?: number;
    applicationPath?: string;
    overriddenGrouping?: OverriddenGrouping | null;
    stacktrace: StackFrame[];
    events: SpanEvent[];
    attributes: Attributes;
};

export type Glow = {
    time: number;
    microtime: number;
    name: string;
    message_level: MessageLevel;
    meta_data: object | object[];
};

export type EntryPointHandler = {
    identifier?: string;
    name?: string;
    type?: string;
};

export type SdkInfo = { name: string; version: string };

export type Framework = { name: string; version?: string };
