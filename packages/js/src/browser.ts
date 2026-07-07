import {
    Api,
    Flare as CoreFlare,
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

export class Flare extends CoreFlare {
    constructor(
        api: Api = new Api(),
        contextCollector: ContextCollector = collectBrowser,
        fileReader: FileReader = new FetchFileReader(),
        scopeProvider: ScopeProvider = new GlobalScopeProvider(),
    ) {
        super(api, contextCollector, fileReader, scopeProvider, new BrowserFlushScheduler());
        this.setSdkInfo({ name: '@flareapp/js', version: CLIENT_VERSION });
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
export { registerNavigationSource, type NavigationSource, type RouteName } from './tracing/browserTracing';
