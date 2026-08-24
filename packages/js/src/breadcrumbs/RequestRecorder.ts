import {
    BrowserSpanType,
    defaultNowNano,
    redactUrlQuery,
    truncateBreadcrumbUrl,
    type Attributes,
} from '@flareapp/core';

import {
    subscribeToRequests,
    type RequestHandlers,
    type RequestSettle,
    type RequestStart,
} from '../instrumentation/requestBus';
import { withRequestPatches } from '../instrumentation/requestInstrumentation';
import { browserUrlContext, isFlareIngestUrl, safeAbsolute } from '../tracing/httpRequestSpan';
import type { BreadcrumbHost, BreadcrumbRecorder } from './types';

const SPAN_TYPES = { fetch: BrowserSpanType.Fetch, xhr: BrowserSpanType.Xhr };

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
        // Our own report, log and trace POSTs are not something a person did.
        if (isFlareIngestUrl(absolute, this.host.config(), base)) {
            return;
        }
        // Bound with this request's own facts, so the settle handler needs no closure over them.
        return { onSettle: this.onSettle.bind(this, start, absolute) };
    }

    private onSettle(start: RequestStart, absolute: URL | null, settle: RequestSettle): void {
        const url = absolute ? absolute.href : start.url;
        const attributes: Attributes = {
            'http.request.method': start.method,
            'url.full': truncateBreadcrumbUrl(redactUrlQuery(url, this.host.config().urlDenylist)),
        };
        if (absolute?.hostname) {
            attributes['server.address'] = absolute.hostname;
        }
        if (settle.status !== undefined) {
            attributes['http.response.status_code'] = settle.status;
        }
        this.host.record(SPAN_TYPES[start.kind], attributes, defaultNowNano());
    }
}
