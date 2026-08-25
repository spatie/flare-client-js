import { breadcrumbUrl, defaultNowNano, type Attributes } from '@flareapp/core';

import {
    subscribeToRequests,
    withRequestPatches,
    type RequestHandlers,
    type RequestSettle,
    type RequestStart,
} from '../instrumentation/requests';
import { browserUrlContext, isFlareIngestUrl, REQUEST_SPAN_TYPES, safeAbsolute } from '../tracing/httpRequestSpan';
import type { BreadcrumbHost, BreadcrumbRecorder } from './types';

export class RequestRecorder implements BreadcrumbRecorder {
    readonly type = 'browser_request';

    constructor(private host: BreadcrumbHost) {
        this.subscribe = this.subscribe.bind(this);
        this.onStart = this.onStart.bind(this);
        this.onSettle = this.onSettle.bind(this);
    }

    install() {
        return withRequestPatches(this.subscribe);
    }

    private subscribe() {
        return subscribeToRequests(this.onStart);
    }

    private onStart(start: RequestStart): RequestHandlers | void {
        const urls = browserUrlContext();
        const base = urls.base();
        const absolute = safeAbsolute(start.url, base);
        // Never record Flare's own report, log and trace posts.
        if (isFlareIngestUrl(absolute, this.host.config(), base)) {
            return;
        }
        return { onSettle: this.onSettle.bind(this, start, absolute) };
    }

    private onSettle(start: RequestStart, absolute: URL | null, settle: RequestSettle): void {
        const url = absolute ? absolute.href : start.url;
        const attributes: Attributes = {
            'http.request.method': start.method,
            'url.full': breadcrumbUrl(url, this.host.config().urlDenylist),
        };
        if (absolute?.hostname) {
            attributes['server.address'] = absolute.hostname;
        }
        if (settle.status !== undefined) {
            attributes['http.response.status_code'] = settle.status;
        }
        this.host.record(REQUEST_SPAN_TYPES[start.kind], attributes, defaultNowNano());
    }
}
