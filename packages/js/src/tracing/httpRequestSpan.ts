import { type Attributes, type Config, redactUrlQuery, type Span, type SpanOptions } from '@flareapp/core';

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

/** True when `url` targets one of Flare's own ingest endpoints (never traced). */
export function isFlareIngestUrl(url: string, origin: string, config: Config): boolean {
    const abs = safeAbsolute(url, origin);
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
