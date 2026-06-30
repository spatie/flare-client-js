export { flare } from './singleton';
export { ReactNativeFlare } from './Flare';
export { FlareErrorBoundary } from './FlareErrorBoundary';
export type { User } from './types';

export { Flare, GlobalScopeProvider, NullFileReader } from '@flareapp/core';
export type {
    AttributeValue,
    Attributes,
    Config,
    ContextCollector,
    FileReader,
    FlushFn,
    FlushScheduler,
    Framework,
    Glow,
    MessageLevel,
    Report,
    ScopeProvider,
    SdkInfo,
    StackFrame,
} from '@flareapp/core';
export { convertToError, DEFAULT_URL_DENYLIST, redactUrlQuery, resolveDenylist } from '@flareapp/core';
