import {
    type Attributes,
    buildTraceparent,
    type Config,
    redactUrlQuery,
    type Span,
    type SpanOptions,
} from '@flareapp/core';

import { shouldPropagate } from './propagation';

/** The subset of the Flare surface the fetch/XHR wrappers need. `Flare` satisfies this structurally. */
export type HttpTracer = {
    readonly config: Config;
    startSpan(name: string, opts?: SpanOptions): Span;
};

/** Resolve `url` to an absolute URL against `origin`, or null if it cannot be parsed. */
export function safeAbsolute(url: string, origin: string): URL | null {
    try {
        return new URL(url, origin || undefined);
    } catch {
        return null;
    }
}

// Resolved ingest hrefs, memoised on the raw values plus origin. The wrappers call this per request,
// and configure() can swap the URLs at any point, so this cannot be computed once at install time.
let ingestCacheKey: string | null = null;
let ingestCacheHrefs: string[] = [];

function resolvedIngestHrefs(config: Config, origin: string): string[] {
    const raw = [config.ingestUrl, config.logsIngestUrl, config.tracesIngestUrl];
    const key = `${origin} ${raw.join(' ')}`;
    if (key !== ingestCacheKey) {
        ingestCacheKey = key;
        ingestCacheHrefs = raw
            .filter((u): u is string => typeof u === 'string' && u.length > 0)
            .map((u) => safeAbsolute(u, origin))
            .filter((u): u is URL => u !== null)
            .map((u) => u.href);
    }
    return ingestCacheHrefs;
}

// Prefix match with a path boundary, so an ingestUrl of `https://x.test/flare` does not also swallow
// `https://x.test/flareapp-assets/app.js`.
function matchesIngestHref(href: string, ingestHref: string): boolean {
    if (!href.startsWith(ingestHref)) {
        return false;
    }
    const next = href.charAt(ingestHref.length);
    return next === '' || next === '/' || next === '?' || next === '#';
}

/**
 * True when `absoluteUrl` targets one of Flare's own ingest endpoints (never traced). The configured
 * URLs are resolved against `origin` first: a relative one (a customer proxying ingest through their
 * own origin) would otherwise never match, so every flush POST would open a span that arms the next
 * flush, forever.
 */
export function isFlareIngestUrl(absoluteUrl: URL | null, config: Config, origin: string): boolean {
    if (!absoluteUrl) {
        return false;
    }
    return resolvedIngestHrefs(config, origin).some((ingestHref) => matchesIngestHref(absoluteUrl.href, ingestHref));
}

/**
 * Shared request-span attributes for a fetch/XHR call. `url.full` is redacted the same way error
 * reports are, so tokens/reset codes never leak.
 */
export function requestSpanAttributes(
    method: string,
    absoluteUrl: URL | null,
    url: string,
    config: Config,
): Attributes {
    return {
        'http.request.method': method,
        'url.full': redactUrlQuery(absoluteUrl ? absoluteUrl.href : url, config.urlDenylist),
        ...(absoluteUrl ? { 'server.address': absoluteUrl.hostname } : {}),
        ...(absoluteUrl && absoluteUrl.port ? { 'server.port': Number(absoluteUrl.port) } : {}),
    };
}

/**
 * Completion mapping shared by fetch and XHR: record the status and mark an error on 5xx.
 * `zeroIsError` additionally maps status 0 to error. XHR passes it only for http(s), where status
 * 0 at DONE is always a network/CORS failure or abort; file:// and custom schemes return 0 on
 * success, so it isn't set there. Fetch never passes it (an opaque no-cors response is 0, not error).
 */
export function endHttpRequestSpan(span: Span, status: number, opts?: { zeroIsError?: boolean }): void {
    span.setAttribute('http.response.status_code', status);
    if (status >= 500 || (opts?.zeroIsError && status === 0)) {
        span.setStatus({ code: 2 });
    }
    span.end();
}

/** Error-finish shared by fetch and XHR: mark the span an error and end it. */
export function finishHttpSpanError(span: Span, error: unknown): void {
    span.setStatus({ code: 2, message: error instanceof Error ? error.message : String(error) });
    span.end();
}

/**
 * Propagation gate plus `traceparent` build shared by fetch and XHR. Returns null when
 * `shouldPropagate` rejects the URL (caller then skips header injection).
 */
export function traceparentFor(
    span: Span,
    absoluteUrl: URL | null,
    url: string,
    origin: string,
    config: Config,
): string | null {
    const resolved = absoluteUrl ? absoluteUrl.href : url;
    if (!shouldPropagate(resolved, absoluteUrl, origin, config.tracePropagationTargets)) {
        return null;
    }
    return buildTraceparent(span.traceId, span.spanId, span.isRecording);
}

/**
 * Open a request span for one outgoing fetch or XHR call. Null means the URL is one of Flare's own
 * ingest endpoints, so the caller passes the request through untraced.
 *
 * `absoluteUrl` comes back with the span because both callers need it afterwards: for the traceparent
 * gate, and for XHR's http(s)-only status-0 rule.
 */
export function startHttpRequestSpan(
    tracer: HttpTracer,
    request: { method: string; url: string; origin: string; spanType: string },
): { span: Span; absoluteUrl: URL | null } | null {
    const { method, url, origin, spanType } = request;
    const config = tracer.config;

    const absoluteUrl = safeAbsolute(url, origin);
    if (isFlareIngestUrl(absoluteUrl, config, origin)) {
        return null;
    }

    const pathname = absoluteUrl ? absoluteUrl.pathname : url;
    const span = tracer.startSpan(`${method} ${pathname}`, {
        spanType,
        attributes: requestSpanAttributes(method, absoluteUrl, url, config),
    });

    return { span, absoluteUrl };
}
