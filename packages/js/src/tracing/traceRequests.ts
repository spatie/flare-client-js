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

/** Tracing takes the mutation slot rather than a plain subscription, to add `traceparent`. */
export function traceRequests(tracer: HttpTracer, urls: UrlContext): () => void {
    return claimRequestMutation((start: RequestStart) => {
        // Per call, because `configure()` can turn tracing off while the patch stays installed.
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

        let init: RequestInit | undefined;
        try {
            const traceparent = traceparentFor(span, absoluteUrl, start.url, urls.origin, tracer.config);
            if (traceparent && start.input !== undefined) {
                init = mergeTraceparentHeader(start.input, start.init, traceparent);
            }
        } catch {
            // The span is already open, so it must still reach `onSettle` below.
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
