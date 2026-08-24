import { claimRequestMutation, type RequestStart } from '../instrumentation/requestBus';
import {
    endHttpRequestSpan,
    finishHttpSpanError,
    type HttpTracer,
    startHttpRequestSpan,
    traceparentFor,
    type UrlContext,
} from './httpRequestSpan';
import { mergeTraceparentHeader } from './propagation';
import { BrowserSpanType } from './spanTypes';

/**
 * Subscribe tracing to the request bus, holding the mutation slot so it can attach `traceparent`.
 *
 * Tracing takes the slot rather than a plain subscription because it is the only consumer that changes
 * the request. Everything else observes.
 */
export function traceRequests(tracer: HttpTracer, urls: UrlContext): () => void {
    return claimRequestMutation((start: RequestStart) => {
        // Read per call, not at subscribe time: configure() can flip tracing at any point, and the
        // patch stays installed for the other consumers either way.
        if (!tracer.config.enableTracing) {
            return;
        }

        const started = startHttpRequestSpan(tracer, {
            method: start.method,
            url: start.url,
            urls,
            spanType: BrowserSpanType.Fetch,
        });
        if (!started) {
            return;
        }
        const { span, absoluteUrl } = started;

        // Guarded separately from the span above: the span already exists here, so a throw must leave
        // it started and let it end normally. Losing the header only costs backend correlation.
        let init: RequestInit | undefined;
        try {
            const traceparent = traceparentFor(span, absoluteUrl, start.url, urls.origin, tracer.config);
            if (traceparent && start.input !== undefined) {
                init = mergeTraceparentHeader(start.input, start.init, traceparent);
            }
        } catch {
            init = undefined;
        }

        return {
            init,
            onSettle({ status, error }): void {
                if (error !== undefined) {
                    finishHttpSpanError(span, error);
                    return;
                }
                endHttpRequestSpan(span, status ?? 0);
            },
        };
    });
}
