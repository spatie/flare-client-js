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

/** Absolutize `url` against `origin`, or null if it cannot be parsed. */
export function safeAbsolute(url: string, origin: string): URL | null {
    try {
        return new URL(url, origin || undefined);
    } catch {
        return null;
    }
}

/** True when `abs` targets one of Flare's own ingest endpoints (never traced). Callers parse the URL once via `safeAbsolute` and pass the result. */
export function isFlareIngestUrl(abs: URL | null, config: Config): boolean {
    if (!abs) return false;
    return [config.ingestUrl, config.logsIngestUrl, config.tracesIngestUrl].some(
        (u) => typeof u === 'string' && u.length > 0 && abs.href.startsWith(u),
    );
}

/**
 * Build the shared request-span attributes for a fetch/XHR call. `url.full` is
 * redacted the same way error reports are, so tokens/reset codes never leak.
 */
export function requestSpanAttributes(method: string, abs: URL | null, url: string, config: Config): Attributes {
    return {
        'http.request.method': method,
        'url.full': redactUrlQuery(abs ? abs.href : url, config.urlDenylist),
        ...(abs ? { 'server.address': abs.hostname } : {}),
        ...(abs && abs.port ? { 'server.port': Number(abs.port) } : {}),
    };
}

/**
 * The success/completion mapping shared by fetch and XHR: record the status code and
 * mark the span as an error on a 5xx. `zeroIsError` additionally maps status 0 to an
 * error — true for XHR (status 0 at DONE is always a network/CORS failure or abort),
 * false for fetch (an opaque no-cors response is status 0 but not an error).
 */
export function endHttpRequestSpan(span: Span, status: number, opts?: { zeroIsError?: boolean }): void {
    span.setAttribute('http.response.status_code', status);
    if (status >= 500 || (opts?.zeroIsError && status === 0)) span.setStatus({ code: 2 });
    span.end();
}

/** The error-finish shared by fetch and XHR: mark the span as an error and end it. */
export function finishHttpSpanError(span: Span, error: unknown): void {
    span.setStatus({ code: 2, message: error instanceof Error ? error.message : String(error) });
    span.end();
}

/**
 * The propagation gate + `traceparent` header build shared by fetch and XHR. Returns
 * null when `shouldPropagate` rejects the URL (caller then skips header injection).
 */
export function traceparentFor(
    span: Span,
    abs: URL | null,
    url: string,
    origin: string,
    config: Config,
): string | null {
    const resolved = abs ? abs.href : url;
    if (!shouldPropagate(resolved, abs, origin, config.tracePropagationTargets)) return null;
    return buildTraceparent(span.traceId, span.spanId, span.isRecording);
}
