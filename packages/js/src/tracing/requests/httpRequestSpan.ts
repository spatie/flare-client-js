import {
    type Attributes,
    BrowserSpanType,
    buildTraceparent,
    type Config,
    type Span,
    SpanStatusCode,
    urlAttributes,
} from '@flareapp/core';

import type { RequestKind } from '../../instrumentation/requests';
import { shouldPropagate } from './propagation';
import type { HttpTracer, UrlContext } from './types';

// A trace and a timeline describe the same request, so they must call it the same thing.
export const REQUEST_SPAN_TYPES: Record<RequestKind, BrowserSpanType> = {
    fetch: BrowserSpanType.Fetch,
    xhr: BrowserSpanType.Xhr,
};

const INLINE_SCHEMES = new Set(['data:', 'blob:']);

// The real browser context. Falls back to the origin where there is no document (SSR, tests).
export function browserUrlContext(): UrlContext {
    const globals = globalThis as { location?: { origin?: string }; document?: { baseURI?: string } };
    const origin = globals.location?.origin ?? '';
    return {
        origin,
        base: () => (globalThis as { document?: { baseURI?: string } }).document?.baseURI || origin,
    };
}

// Resolve `url` to an absolute URL against `base`, or null if it cannot be parsed.
export function safeAbsolute(url: string, base: string): URL | null {
    try {
        return new URL(url, base || undefined);
    } catch {
        return null;
    }
}

// Ingest hrefs, cached on the raw values plus base. configure() can change the URLs at any time,
// so this cannot be computed once at install time.
let ingestCacheKey: string | null = null;
let ingestCacheHrefs: string[] = [];

function resolvedIngestHrefs(config: Config, base: string): string[] {
    const raw = [config.ingestUrl, config.logsIngestUrl, config.tracesIngestUrl];
    const key = `${base} ${raw.join(' ')}`;
    if (key !== ingestCacheKey) {
        ingestCacheKey = key;
        ingestCacheHrefs = raw
            .filter((u): u is string => typeof u === 'string' && u.length > 0)
            .map((u) => safeAbsolute(u, base))
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

// True when `resolved` targets one of Flare's own ingest endpoints (never traced). URLs are resolved
// against `base` first, so a relative ingest URL still matches. Without this, every flush POST would
// open a span that triggers another flush, forever.
export function isFlareIngestUrl(resolved: URL | null, config: Config, base: string): boolean {
    if (!resolved) {
        return false;
    }
    return resolvedIngestHrefs(config, base).some((ingestHref) => matchesIngestHref(resolved.href, ingestHref));
}

// Shared request-span attributes for a fetch/XHR call. The `url.*` attributes are redacted the same
// way as error reports, so tokens and reset codes never leak.
export function requestSpanAttributes(method: string, resolved: URL | null, url: string, config: Config): Attributes {
    return {
        'http.request.method': method,
        ...urlAttributes(resolved ? resolved.href : url, config.urlDenylist),
        ...(resolved ? { 'server.address': resolved.hostname } : {}),
        ...(resolved && resolved.port ? { 'server.port': Number(resolved.port) } : {}),
    };
}

// Shared by fetch and XHR: records the status and marks an error on 5xx. `zeroIsError` also treats
// status 0 as an error, but only for XHR on http(s) — there, status 0 at DONE always means a
// network/CORS failure or abort. Fetch never passes it, since an opaque no-cors response is 0 too.
export function endHttpRequestSpan(span: Span, status: number, opts?: { zeroIsError?: boolean }): void {
    span.setAttribute('http.response.status_code', status);
    if (status >= 500 || (opts?.zeroIsError && status === 0)) {
        span.setStatus({ code: SpanStatusCode.Error });
    }
    span.end();
}

export function finishHttpSpanError(span: Span, error: unknown): void {
    span.setStatus({ code: SpanStatusCode.Error, message: error instanceof Error ? error.message : String(error) });
    span.end();
}

// Propagation gate plus `traceparent` build shared by fetch and XHR. Returns null when
// `shouldPropagate` rejects the URL (caller then skips header injection).
export function traceparentFor(
    span: Span,
    resolved: URL | null,
    url: string,
    origin: string,
    config: Config,
): string | null {
    const resolvedHref = resolved ? resolved.href : url;
    if (!shouldPropagate(resolvedHref, resolved, origin, config.tracePropagationTargets)) {
        return null;
    }
    return buildTraceparent(span.traceId, span.spanId, span.isRecording);
}

// Opens a request span for one outgoing fetch or XHR call. Returns null when the URL is one of
// Flare's own ingest endpoints, so the caller passes the request through untraced.
//
// `absoluteUrl` comes back with the span because both callers need it later: for the traceparent
// gate, and for XHR's http(s)-only status-0 rule.
export function startHttpRequestSpan(
    tracer: HttpTracer,
    request: { method: string; url: string; urls: UrlContext; spanType: string },
): { span: Span; absoluteUrl: URL | null } | null {
    const { method, url, urls, spanType } = request;
    const config = tracer.config;

    const base = urls.base();
    const resolved = safeAbsolute(url, base);
    if (isFlareIngestUrl(resolved, config, base)) {
        return null;
    }
    // A data:/blob: read is not network traffic, and a data: URL carries its whole payload in the url.
    if (resolved && INLINE_SCHEMES.has(resolved.protocol)) {
        return null;
    }

    const pathname = resolved ? resolved.pathname : url;
    const span = tracer.startSpan(`${method} ${pathname}`, {
        spanType,
        attributes: requestSpanAttributes(method, resolved, url, config),
    });

    return { span, absoluteUrl: resolved };
}
