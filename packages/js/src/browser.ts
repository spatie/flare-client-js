import {
    Api,
    Flare as CoreFlare,
    FrameworkName,
    GlobalScopeProvider,
    type Config,
    type ContextCollector,
    type FileReader,
    type ScopeProvider,
} from '@flareapp/core';

import { BrowserFlushScheduler } from './browser/BrowserFlushScheduler';
import { collectBrowser } from './browser/context/collectBrowser';
import { FetchFileReader } from './browser/FetchFileReader';
import { CLIENT_VERSION } from './env';
import {
    instrumentFetch,
    instrumentXHR,
    startBrowserTracing,
    stopBrowserTracing,
    unpatchFetch,
    unpatchXHR,
} from './tracing';

export { createFlareResolver } from './createFlareResolver';

export class Flare extends CoreFlare {
    constructor(
        api: Api = new Api(),
        contextCollector: ContextCollector = collectBrowser,
        fileReader: FileReader = new FetchFileReader(),
        scopeProvider: ScopeProvider = new GlobalScopeProvider(),
    ) {
        super(api, contextCollector, fileReader, scopeProvider, new BrowserFlushScheduler());
        this.setSdkInfo({ name: '@flareapp/js', version: CLIENT_VERSION });
        // Claim 'js' as the framework so a vanilla browser app is never framework-less on the wire.
        // Framework packages overwrite this: they import this root (constructing the singleton, which
        // runs this line) before tagging their own name, so the more specific value always wins.
        this.setFramework({ name: FrameworkName.Js });
    }

    override configure(config: Partial<Config>): this {
        const wasTracing = this.config.enableTracing;
        super.configure(config);
        const nowTracing = this.config.enableTracing;

        if (!wasTracing && nowTracing) {
            instrumentFetch(this);
            instrumentXHR(this);
            startBrowserTracing(this);
        } else if (wasTracing && !nowTracing) {
            stopBrowserTracing();
            unpatchFetch();
            unpatchXHR();
        }

        return this;
    }
}

export { catchWindowErrors } from './browser/catchWindowErrors';
export { collectBrowser } from './browser/context/collectBrowser';
export { FetchFileReader } from './browser/FetchFileReader';
export { BrowserFlushScheduler } from './browser/BrowserFlushScheduler';
export { registerNavigationSource } from './tracing/browserTracing';
export { currentPath, resolveHref, routeName, type NavigationSource, type RouteName } from './tracing/navigation';
export { insulate, instrumentOnce, safeInvoke, type TrackTeardown } from './tracing/instrumentationGuard';
export { absoluteHref, absoluteUrl } from './tracing/absoluteHref';
export {
    activeComponentRoot,
    reserveSpanId,
    recordComponentSpan,
    resolveComponentParent,
    nowNano,
    type ComponentSpanRecord,
    type ComponentTraceContext,
} from './tracing/componentProfiler';
export { BrowserSpanType } from './tracing/spanTypes';
