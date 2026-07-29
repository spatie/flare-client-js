export type {
    AnyValue,
    AttributeValue,
    Attributes,
    BufferedLog,
    BufferedSpan,
    Config,
    EntryPointHandler,
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
    SpanStatusCode,
    StackFrame,
    TracesEnvelope,
    TracesSampler,
    User,
} from './types';

// createComponentMatcher / ProfileComponentsOption are deliberately NOT re-exported here. They are
// build-time helpers meant to be imported from '@flareapp/core/util' by a svelte.config.js without
// pulling in this root entry (and everything it drags along).
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
    InMemoryActiveSpanHolder,
    buildTracesEnvelope,
    buildTraceparent,
    parseTraceparent,
    spanId,
} from './tracing';
export type { TracerDeps, ActiveSpanHolder } from './tracing';

export { NullFileReader } from './stacktrace/NullFileReader';
export type { FileReader } from './stacktrace/fileReader';

export { createStackTrace } from './stacktrace/createStackTrace';
export { getCodeSnippet, readLinesFromFile } from './stacktrace/fileReader';
