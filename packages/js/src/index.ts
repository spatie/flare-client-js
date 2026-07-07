import { catchWindowErrors, Flare } from './browser';

export { Flare } from './browser';

export const flare = new Flare();

if (typeof window !== 'undefined' && window) {
    // @ts-expect-error attach to window
    window.flare = flare;
    catchWindowErrors();
}

export { Logger, Scope, GlobalScopeProvider, NullFileReader } from '@flareapp/core';
export type {
    AttributeValue,
    Attributes,
    Config,
    ContextCollector,
    EntryPointHandler,
    FileReader,
    FlushFn,
    FlushScheduler,
    Framework,
    Glow,
    MessageLevel,
    OverriddenGrouping,
    Report,
    ScopeProvider,
    SdkInfo,
    SpanEvent,
    StackFrame,
    User,
} from '@flareapp/core';
export { convertToError, DEFAULT_URL_DENYLIST, redactUrlQuery, resolveDenylist } from '@flareapp/core';

/** @deprecated use redactUrlQuery instead - same behavior, more honest name */
export { redactUrlQuery as redactFullPath } from '@flareapp/core';
