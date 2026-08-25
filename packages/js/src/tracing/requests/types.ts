import type { Config, Span, SpanOptions } from '@flareapp/core';

export type FetchInput = string | URL | Request;

/** The subset of the Flare surface the fetch/XHR wrappers need. `Flare` satisfies this structurally. */
export type HttpTracer = {
    readonly config: Config;
    startSpan(name: string, opts?: SpanOptions): Span;
};

/**
 * The two URL facts a request needs, kept apart on purpose. `base` is what the browser resolves a
 * relative request URL against (`document.baseURI`: the document URL, or a `<base href>`), while
 * `origin` is the page's own origin, which is what the default same-origin propagation rule asks
 * about. They differ under a sub-path or a cross-origin `<base href>`.
 */
export type UrlContext = {
    origin: string;
    /** Read per request: pushState changes `document.baseURI` without a page load. */
    base(): string;
};
