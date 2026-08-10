export type {
    AnyValue,
    AttributeValue,
    Attributes,
    BufferedLog,
    BufferedSpan,
    Config,
    EntryPointHandler,
    EntryPointType,
    Framework,
    Glow,
    KeyValue,
    LogsEnvelope,
    MessageLevel,
    OtelLogRecord,
    OtelSpan,
    OverriddenGrouping,
    Report,
    SamplingContext,
    SdkInfo,
    Span,
    SpanEvent,
    SpanOptions,
    SpanStatus,
    StackFrame,
    TracesEnvelope,
    TracesSampler,
    User,
} from './types';

// createComponentMatcher is left out on purpose. A svelte.config.js should get it from
// '@flareapp/core/util' instead of pulling in this entry and everything it drags along.
export {
    assert,
    assertKey,
    convertToError,
    createIdentityTagger,
    DEFAULT_URL_DENYLIST,
    describeRejectionReason,
    extractCode,
    flatJsonStringify,
    glowsToEvents,
    now,
    redactObjectValues,
    redactUrlQuery,
    resolveDenylist,
    routeRejection,
    safeClone,
    safeDecode,
    toCustomContext,
} from './util';
export type { RejectionReporter, SafeCloneOptions, SdkTaggable } from './util';

export { FrameworkName } from './framework';
export { BrowserSpanType } from './spanTypes';
export type { SpanTypeName } from './spanTypes';
export { SpanStatusCode } from './types';

export { Api } from './api';

export { Flare } from './Flare';
export type { ContextCollector } from './Flare';

export { Scope, GlobalScopeProvider, USER_IDENTITY_KEYS, userIdentityAttributes } from './Scope';
export type { ScopeProvider } from './Scope';

export { Logger, NoopFlushScheduler } from './logging';
export type { FlushScheduler, FlushFn, LoggerDeps } from './logging';

export {
    Tracer,
    defaultNowNano,
    DEFAULT_MAX_LIVE_TRACES,
    InMemoryActiveSpanHolder,
    buildTracesEnvelope,
    buildTraceparent,
    parseTraceparent,
    spanId,
} from './tracing';
export type { TracerDeps, ActiveSpanHolder, SpanPhase, SpanLifecycleEvent, SpanLifecycleListener } from './tracing';

export { NullFileReader } from './stacktrace/NullFileReader';
export type { FileReader } from './stacktrace/fileReader';

export { createStackTrace } from './stacktrace/createStackTrace';
export { getCodeSnippet, readLinesFromFile } from './stacktrace/fileReader';
