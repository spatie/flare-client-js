import { Api, Flare, GlobalScopeProvider } from '@flareapp/core';

import { catchWindowErrors } from './browser';
import { collectBrowser } from './browser/context/collectBrowser';
import { FetchFileReader } from './browser/FetchFileReader';
import { CLIENT_VERSION } from './env';

export const flare = new Flare(new Api(), new GlobalScopeProvider(), collectBrowser, new FetchFileReader());

flare.setSdkInfo({ name: '@flareapp/js', version: CLIENT_VERSION });

if (typeof window !== 'undefined' && window) {
    // @ts-expect-error attach to window
    window.flare = flare;
    catchWindowErrors();
}

export { Flare, Scope, GlobalScopeProvider, NullFileReader } from '@flareapp/core';
export type {
    AttributeValue,
    Attributes,
    Config,
    ContextCollector,
    EntryPointHandler,
    FileReader,
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

/** @deprecated use redactUrlQuery instead — same behavior, more honest name */
export { redactUrlQuery as redactFullPath } from '@flareapp/core';
