import { createFetchWrapper } from '../../src/instrumentation/requests';
import type { HttpTracer, UrlContext } from '../../src/tracing/requests';
import { traceRequests } from '../../src/tracing/requests';

/** The wrapper is neutral now, so a test that asserts tracing must wire tracing behind it. */
export function tracedFetch(tracer: HttpTracer, original: typeof fetch, urls: UrlContext): typeof fetch {
    traceRequests(tracer, urls);
    return createFetchWrapper(original);
}
