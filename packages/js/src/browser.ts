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

import { startBreadcrumbs } from './breadcrumbs';
import { BrowserFlushScheduler } from './browser/BrowserFlushScheduler';
import { collectBrowser } from './browser/context/collectBrowser';
import { FetchFileReader } from './browser/FetchFileReader';
import { CLIENT_VERSION } from './env';
import { withRequestPatches } from './instrumentation/requests';
import { startBrowserTracing, stopBrowserTracing } from './tracing';
import { browserUrlContext, traceRequests } from './tracing/requests';

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
        // Claim 'js' as the default framework so a vanilla app is never framework-less on the wire.
        // Framework packages overwrite this on import, since they tag their own name after this runs.
        this.setFramework({ name: FrameworkName.Js });
    }

    // Held so a later disable can give the mutation slot back.
    private removeTracingSubscription: (() => void) | null = null;
    private stopBreadcrumbs: (() => void) | null = null;

    override configure(config: Partial<Config>): this {
        const wasTracing = this.config.enableTracing;
        const wasBreadcrumbs = this.config.enableBreadcrumbs;
        super.configure(config);
        const nowTracing = this.config.enableTracing;
        const nowBreadcrumbs = this.config.enableBreadcrumbs;

        if (!wasBreadcrumbs && nowBreadcrumbs) {
            this.stopBreadcrumbs = startBreadcrumbs({
                config: () => this.config,
                record: (type, attributes, startTimeUnixNano) =>
                    this.addBreadcrumb(type, attributes, startTimeUnixNano),
            });
        } else if (wasBreadcrumbs && !nowBreadcrumbs) {
            this.stopBreadcrumbs?.();
            this.stopBreadcrumbs = null;
        }

        if (!wasTracing && nowTracing) {
            this.removeTracingSubscription = withRequestPatches(() => traceRequests(this, browserUrlContext()));
            startBrowserTracing(this);
        } else if (wasTracing && !nowTracing) {
            stopBrowserTracing();
            this.removeTracingSubscription?.();
            this.removeTracingSubscription = null;
        }

        return this;
    }
}

export { catchWindowErrors } from './browser/catchWindowErrors';
export { collectBrowser } from './browser/context/collectBrowser';
export { FetchFileReader } from './browser/FetchFileReader';
export { BrowserFlushScheduler } from './browser/BrowserFlushScheduler';
export {
    currentHref,
    currentPath,
    registerNavigationSource,
    resolveHref,
    routeName,
    type NavigationSource,
    type RouteName,
} from './instrumentation/navigation';
export { absoluteHref, absoluteUrl, insulate, instrumentOnce, safeInvoke, type TrackTeardown } from './tracing/utils';
export {
    activeComponentRoot,
    reserveSpanId,
    recordComponentSpan,
    resolveComponentParent,
    nowNano,
    type ComponentSpanRecord,
    type ComponentTraceContext,
} from './tracing/roots';
export { BrowserSpanType } from './tracing/spanTypes';
