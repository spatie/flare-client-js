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
    replaceDefaultUrlDenylist: boolean;
    sampleRate: number;
    enableLogs: boolean;
    logsIngestUrl: string;
    minimumLogLevel?: MessageLevel;
    serviceName?: string;
    maxLogBufferSize: number;
    logFlushIntervalMs: number;
    logFlushMaxBytes: number;
    keepaliveMaxBytes: number;
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
    messageLevel: MessageLevel;
    metaData: Record<string, unknown> | Record<string, unknown>[];
};

export type EntryPointHandler = {
    identifier?: string;
    name?: string;
    type?: string;
};

export type SdkInfo = { name: string; version: string };

export type Framework = { name: string; version?: string };

// --- Logging ---

export type AnyValue =
    | { stringValue: string }
    | { boolValue: boolean }
    | { intValue: number }
    | { doubleValue: number }
    | { arrayValue: { values: AnyValue[] } }
    | { kvlistValue: { values: KeyValue[] } };

export type KeyValue = { key: string; value: AnyValue };

export type OtelResource = { attributes: KeyValue[]; droppedAttributesCount: number };

export type OtelScope = {
    name: string;
    version: string;
    attributes: KeyValue[];
    droppedAttributesCount: number;
};

export type OtelLogRecord = {
    timeUnixNano: string;
    observedTimeUnixNano: string;
    severityNumber: number;
    severityText: string;
    body: AnyValue;
    attributes: KeyValue[];
    flags: number;
    droppedAttributesCount: number;
};

export type LogsEnvelope = {
    resourceLogs: Array<{
        resource: OtelResource;
        scopeLogs: Array<{ scope: OtelScope; logRecords: OtelLogRecord[] }>;
    }>;
};

// Internal buffered shape (pre-encoding).
export type BufferedLog = {
    timeUnixNano: string;
    severityNumber: number;
    severityText: string;
    message: string;
    recordAttributes: KeyValue[];
    resourceAttributes: Attributes;
};
