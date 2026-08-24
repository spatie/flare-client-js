import { createFetchWrapper } from '../../src/instrumentation/instrumentFetch';
import type { UrlContext } from '../../src/tracing/httpRequestSpan';
import type { HttpTracer } from '../../src/tracing/httpRequestSpan';
import { traceRequests } from '../../src/tracing/traceRequests';

/**
 * A fetch wrapper with tracing subscribed to the bus behind it. The wrapper itself is neutral now, so a
 * test that asserts tracing behaviour has to wire the consumer that produces it.
 */
export function tracedFetch(tracer: HttpTracer, original: typeof fetch, urls: UrlContext): typeof fetch {
    traceRequests(tracer, urls);
    return createFetchWrapper(original);
}
