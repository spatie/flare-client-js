import {
    Api,
    Flare as CoreFlare,
    GlobalScopeProvider,
    type ContextCollector,
    type FileReader,
    type ScopeProvider,
} from '@flareapp/core';

import { catchWindowErrors } from './browser';
import { collectBrowser } from './browser/context/collectBrowser';
import { FetchFileReader } from './browser/FetchFileReader';
import { CLIENT_VERSION } from './env';

export class Flare extends CoreFlare {
    constructor(
        api: Api = new Api(),
        contextCollector: ContextCollector = collectBrowser,
        fileReader: FileReader = new FetchFileReader(),
        scopeProvider: ScopeProvider = new GlobalScopeProvider(),
    ) {
        super(api, contextCollector, fileReader, scopeProvider);
        this.setSdkInfo({ name: '@flareapp/js', version: CLIENT_VERSION });
    }
}

export const flare = new Flare();

if (typeof window !== 'undefined' && window) {
    // @ts-expect-error attach to window
    window.flare = flare;
    catchWindowErrors();
}

export { Scope, GlobalScopeProvider, NullFileReader } from '@flareapp/core';
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
