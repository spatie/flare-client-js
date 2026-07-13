export type MessageLevel = 'debug' | 'info' | 'notice' | 'warning' | 'error' | 'critical' | 'alert' | 'emergency';

export type AttributeValue = string | number | boolean | null | AttributeValue[] | { [key: string]: AttributeValue };

export type Attributes = Record<string, AttributeValue>;

/**
 * An identified user passed to `Flare.setUser`. Known fields project to the backend keys: `id`->`user.id`,
 * `email`->`user.email`, `fullName`->`user.full_name`, `ipAddress`->`client.address`. Any other key lands in
 * `user.attributes`. Caveat: the open index signature means a misspelled known field (e.g. `full_name` for `fullName`)
 * silently lands in `user.attributes` with no type error. Spell the four known fields exactly.
 */
export type User = {
    id?: string | number;
    email?: string;
    fullName?: string;
    ipAddress?: string;
    [key: string]: AttributeValue | undefined;
};

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
    enableTracing: boolean;
    tracesIngestUrl: string;
    tracesSampleRate: number;
    tracesSampler?: TracesSampler;
    /**
     * URLs a W3C `traceparent` header may be attached to on outgoing requests. Default (unset): same-origin + relative
     * only; `[]` disables all injection. Each entry matches by String.includes (string) or RegExp.test. Attaching
     * cross-origin forces a CORS preflight; the target server must allow the `traceparent` request header.
     */
    tracePropagationTargets?: (string | RegExp)[];
    /** Idle-span: ms of no open child spans before a pageload/navigation root closes. Browser default 1000. */
    idleTimeout?: number;
    /** Idle-span: hard cap in ms from root start before it closes regardless of activity. Browser default 30000. */
    finalTimeout?: number;
    /** Idle-span: if a child span stays open this many ms, the root closes anyway. Browser default 15000. */
    childSpanTimeout?: number;
    maxSpanBufferSize: number;
    spanFlushIntervalMs: number;
    spanFlushMaxBytes: number;
    maxSpansPerTrace: number;
    maxAttributesPerSpan: number;
    maxEventsPerSpan: number;
    maxAttributesPerSpanEvent: number;
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

// Logging

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

// Tracing

export type SpanStatusCode = 0 | 1 | 2; // Unset | Ok | Error (OTel)

export type SpanStatus = { code: SpanStatusCode; message?: string };

export type SpanOptions = {
    parent?: Span | { traceId: string; spanId: string };
    attributes?: Attributes;
    startTimeUnixNano?: number;
    spanType?: string;
    /**
     * Start this span as a new trace root, ignoring any ambient active span, so a
     * root opened inside `withSpan(...)` does not become a mid-trace child.
     */
    forceRoot?: boolean;
    /** Use this exact span id instead of generating one (manual span stitching). */
    spanId?: string;
};

export interface Span {
    readonly traceId: string;
    readonly spanId: string;
    readonly parentSpanId: string | null;
    name: string;
    readonly isRecording: boolean;
    readonly endTimeUnixNano: number;
    setAttribute(key: string, value: AttributeValue): this;
    setStatus(status: SpanStatus): this;
    addEvent(name: string, attributes?: Attributes): this;
    end(endTimeUnixNano?: number): void;
}

export type SamplingContext = {
    name: string;
    parentSampled?: boolean;
    attributes: Attributes;
    spanType?: string;
};

export type TracesSampler = (ctx: SamplingContext) => number | boolean;

export type BufferedSpanEvent = {
    name: string;
    timeUnixNano: number;
    attributes: KeyValue[];
    droppedAttributesCount: number;
};

export type BufferedSpan = {
    traceId: string;
    spanId: string;
    parentSpanId: string | null;
    name: string;
    startTimeUnixNano: number;
    endTimeUnixNano: number;
    status: SpanStatus;
    recordAttributes: KeyValue[];
    droppedAttributesCount: number;
    droppedEventsCount: number;
    events: BufferedSpanEvent[];
};

export type OtelSpan = {
    traceId: string;
    spanId: string;
    parentSpanId: string | null; // always present; null for roots
    name: string;
    startTimeUnixNano: number;
    endTimeUnixNano: number;
    status: { code: number; message?: string };
    attributes: KeyValue[];
    events: BufferedSpanEvent[];
    droppedAttributesCount: number;
    droppedEventsCount: number;
    links: never[];
    droppedLinksCount: number;
};

export type TracesEnvelope = {
    resourceSpans: Array<{
        resource: OtelResource;
        scopeSpans: Array<{ scope: OtelScope; spans: OtelSpan[] }>;
    }>;
};
