export type MessageLevel = 'debug' | 'info' | 'notice' | 'warning' | 'error' | 'critical' | 'alert' | 'emergency';

export type AttributeValue = string | number | boolean | null | AttributeValue[] | { [key: string]: AttributeValue };

export type Attributes = Record<string, AttributeValue>;

/**
 * An identified user passed to `Flare.setUser`. The four known fields project to the
 * report keys the Flare backend reads: `id`→`user.id`, `email`→`user.email`,
 * `fullName`→`user.full_name`, `ipAddress`→`client.address`. Any OTHER key is bundled
 * into `user.attributes`.
 *
 * Caveat: the open index signature means a misspelled known field (e.g. `fullname` or
 * `full_name` instead of `fullName`) does NOT raise a type error — it silently lands in
 * `user.attributes` rather than the identity key. Spell the four known fields exactly.
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

/**
 * The framework identity every SDK reports. `name` is WIRE FORMAT: it ships as the
 * `flare.framework.name` resource attribute on traces and logs, as an attribute on error reports, and
 * (lowercased) as `context.custom.framework`. The Flare backend keys off it, so it is a fixed
 * vocabulary, not a display string: lowercase, no spaces, hyphenated only where the package name is.
 *
 * The values the first-party SDKs emit, and the only ones the backend recognises:
 * `js`, `react`, `vue`, `svelte`, `sveltekit`, `react-native`.
 *
 * `js` is the browser SDK's own claim, set when `@flareapp/js` constructs its Flare. It means "no
 * framework package reported one", which for a vanilla app is the truth and for an app that only
 * imports a framework package's side entry (e.g. `@flareapp/react/profiler`) is the closest the SDK
 * can get. A framework package always overwrites it, because it imports the js root first.
 *
 * A host app may call `setFramework` with its own value; anything outside the list above is treated
 * as unknown by the backend rather than rejected. Render a display name from this, never the reverse.
 */
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
