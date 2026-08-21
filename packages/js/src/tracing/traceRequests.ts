import { SpanStatusCode, type Span } from '@flareapp/core';

import type { Unsubscribe } from '../instrument/handlers';
import {
    addRequestSettleHandler,
    type RequestContext,
    type RequestResult,
    type RequestSettleHandler,
    type RequestStartHandler,
    setRequestStartHandler,
} from '../instrument/request';
import {
    endHttpRequestSpan,
    finishHttpSpanError,
    type HttpTracer,
    requestSpanAttributes,
    traceparentFor,
    type UrlContext,
} from './httpRequestSpan';
import { BrowserSpanType } from './spanTypes';

// Keyed on the context object the instrumentation hands to both hooks, so a request needs no id and
// a span that never settles is collected with its context.
const spans = new WeakMap<RequestContext, Span>();

const SPAN_TYPE: Record<RequestContext['kind'], string> = {
    fetch: BrowserSpanType.Fetch,
    xhr: BrowserSpanType.Xhr,
};

/** Open the span and hand back the `traceparent`. Tracing is the only owner of this hook. */
function onStart(tracer: HttpTracer, urls: UrlContext, context: RequestContext): string | null {
    const config = tracer.config;
    if (!config.enableTracing) {
        return null;
    }
    const pathname = context.absoluteUrl ? context.absoluteUrl.pathname : context.url;
    // Deliberately NOT passing `startTimeUnixNano` from the context, even though it is a few
    // microseconds more accurate. `startSpan` stamping its own start is today's behaviour, and this
    // plan changes no payload. The context's start time exists for a settle handler that has to build
    // a span itself, which tracing does not.
    const span = tracer.startSpan(`${context.method} ${pathname}`, {
        spanType: SPAN_TYPE[context.kind],
        attributes: requestSpanAttributes(context.method, context.absoluteUrl, context.url, config),
    });
    spans.set(context, span);
    return traceparentFor(span, context.absoluteUrl, context.url, urls.origin, config);
}

function onSettle(context: RequestContext, result: RequestResult): void {
    const span = spans.get(context);
    if (!span) {
        return;
    }
    spans.delete(context);
    if (result.aborted) {
        // Today's abort payload, exactly: an error status with no message and no
        // http.response.status_code attribute. finishHttpSpanError would add the message and
        // endHttpRequestSpan would add the attribute, so neither is usable here.
        span.setStatus({ code: SpanStatusCode.Error });
        span.end();
        return;
    }
    if (result.error !== undefined) {
        finishHttpSpanError(span, result.error);
        return;
    }
    // status 0 means "no HTTP response" (network or CORS failure) only for an XHR over http(s).
    // A fetch status 0 is an opaque no-cors response, which is not a failure. file:// and custom
    // schemes (Electron's registerFileProtocol) return 0 on success, and an unparseable url tells
    // us nothing either way.
    const protocol = context.absoluteUrl?.protocol;
    const zeroIsError = context.kind === 'xhr' && (protocol === 'http:' || protocol === 'https:');
    endHttpRequestSpan(span, result.status, { zeroIsError });
}

/** Test-only export: tracing's two handlers, without touching the registry. */
export function tracingRequestHandlers(
    tracer: HttpTracer,
    urls: UrlContext,
): { onStart: RequestStartHandler; onSettle: RequestSettleHandler } {
    return { onStart: (context) => onStart(tracer, urls, context), onSettle };
}

/** Register tracing's two request handlers. The returned function removes both. */
export function startTracingRequests(tracer: HttpTracer, urls: UrlContext): Unsubscribe {
    const handlers = tracingRequestHandlers(tracer, urls);
    const stopStart = setRequestStartHandler(handlers.onStart);
    const stopSettle = addRequestSettleHandler(handlers.onSettle);
    return () => {
        stopStart();
        stopSettle();
    };
}
