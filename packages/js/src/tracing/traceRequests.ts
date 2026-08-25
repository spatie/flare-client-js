import { type Span, SpanStatusCode } from '@flareapp/core';

import { claimRequestMutation, type MutatedRequest, type RequestStart } from '../instrumentation/requests';
import {
    endHttpRequestSpan,
    finishHttpSpanError,
    type HttpTracer,
    REQUEST_SPAN_TYPES,
    startHttpRequestSpan,
    traceparentFor,
    type UrlContext,
} from './httpRequestSpan';
import { mergeTraceparentHeader } from './propagation';

/**
 * For http and https, status 0 at DONE means the request got no response.
 *
 * Other schemes return 0 when they succeed. file:// does, and so do custom ones like Electron's
 * registerFileProtocol. A URL we could not parse is not an error either.
 */
function zeroIsError(absoluteUrl: URL | null): boolean {
    return absoluteUrl !== null && (absoluteUrl.protocol === 'http:' || absoluteUrl.protocol === 'https:');
}

function propagate(
    span: Span,
    absoluteUrl: URL | null,
    start: RequestStart,
    urls: UrlContext,
    tracer: HttpTracer,
): MutatedRequest {
    const traceparent = traceparentFor(span, absoluteUrl, start.url, urls.origin, tracer.config);
    if (!traceparent) {
        return {};
    }
    if (start.kind === 'xhr') {
        return { headers: { traceparent } };
    }
    if (start.input === undefined) {
        return {};
    }
    return { init: mergeTraceparentHeader(start.input, start.init, traceparent) };
}

/** Tracing takes the mutation slot, not a plain subscription, because it adds a `traceparent` header. */
export function traceRequests(tracer: HttpTracer, urls: UrlContext): () => void {
    return claimRequestMutation((start: RequestStart) => {
        // Check on every call: `configure()` can turn tracing off while the patch stays installed.
        if (!tracer.config.enableTracing) {
            return;
        }

        const started = startHttpRequestSpan(tracer, {
            method: start.method,
            url: start.url,
            urls,
            spanType: REQUEST_SPAN_TYPES[start.kind],
        });
        if (!started) {
            return;
        }
        const { span, absoluteUrl } = started;

        let mutated: MutatedRequest = {};
        try {
            mutated = propagate(span, absoluteUrl, start, urls, tracer);
        } catch {
            // The span is already open, so it must still reach `onSettle` below. Send no header.
            mutated = {};
        }

        return {
            ...mutated,
            onSettle({ status, error, aborted }): void {
                if (aborted) {
                    span.setStatus({ code: SpanStatusCode.Error });
                    span.end();
                    return;
                }
                if (error !== undefined) {
                    finishHttpSpanError(span, error);
                    return;
                }
                if (start.kind === 'xhr') {
                    endHttpRequestSpan(span, status ?? 0, { zeroIsError: zeroIsError(absoluteUrl) });
                    return;
                }
                endHttpRequestSpan(span, status ?? 0);
            },
        };
    });
}
