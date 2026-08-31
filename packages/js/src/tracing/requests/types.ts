import type { Config, Span, SpanOptions } from '@flareapp/core';

export type FetchInput = string | URL | Request;

// The subset of the Flare surface the fetch/XHR wrappers need. `Flare` satisfies this structurally.
export type HttpTracer = {
    readonly config: Config;
    startSpan(name: string, opts?: SpanOptions): Span;
};

// The two URL facts a request needs, kept apart on purpose. `base` is what the browser resolves a
// relative URL against (`document.baseURI`, or a `<base href>`). `origin` is the page's own origin,
// used by the same-origin propagation rule. They differ under a sub-path or cross-origin `<base href>`.
export type UrlContext = {
    origin: string;
    // Read per request: pushState changes `document.baseURI` without a page load.
    base(): string;
};
