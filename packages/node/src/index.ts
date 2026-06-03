import { NodeFlare } from './Flare';

export const flare = new NodeFlare();

export { NodeFlare } from './Flare';
export type { RequestContext, User, FatalMode, NodeOptions } from './types';
export { Flare, Logger, Scope, GlobalScopeProvider, NullFileReader } from '@flareapp/core';
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
} from '@flareapp/core';
export { convertToError, DEFAULT_URL_DENYLIST, redactUrlQuery, resolveDenylist } from '@flareapp/core';

export { NodeScope } from './scope/NodeScope';
