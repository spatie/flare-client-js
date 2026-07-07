import { buildTraceparent, type Span } from '@flareapp/core';

import { createPatcher } from './createPatcher';
import { type HttpTracer, isFlareIngestUrl, requestSpanAttributes, safeAbsolute } from './httpRequestSpan';
import { shouldPropagate } from './propagation';

type XhrOpen = XMLHttpRequest['open'];
type XhrSend = XMLHttpRequest['send'];
type XhrSetHeader = XMLHttpRequest['setRequestHeader'];

type XhrState = {
    method: string;
    url: string;
    span?: Span;
    hasAppTraceparent: boolean;
    ended: boolean;
};

// One logical XHR request spreads across open() -> setRequestHeader()* -> send() ->
// readystatechange. A WeakMap keyed by the instance threads state across those calls
// without polluting the instance (unlike Sentry's __sentry_xhr_v3__ property); entries
// are GC'd with the request.
const xhrState = new WeakMap<XMLHttpRequest, XhrState>();

/** Patch `open` to capture method/URL. Bails (records no state) when either is missing. */
export function createXHROpen(original: XhrOpen): XhrOpen {
    return function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]): void {
        if (method && url != null && String(url) !== '') {
            xhrState.set(this, {
                method: String(method).toUpperCase(),
                url: String(url),
                hasAppTraceparent: false,
                ended: false,
            });
        } else {
            // Clear any prior entry so a reused instance can't resurrect stale, already-ended
            // state on a later send().
            xhrState.delete(this);
        }
        return (original as (this: XMLHttpRequest, ...a: unknown[]) => void).apply(this, [method, url, ...rest]);
    } as XhrOpen;
}

/**
 * Patch `setRequestHeader` to note when the app sets its own `traceparent`.
 * There is no `getRequestHeader`, so this is the only way to avoid emitting a
 * second `traceparent` (repeat calls merge into one malformed header).
 */
export function createXHRSetRequestHeader(original: XhrSetHeader): XhrSetHeader {
    return function (this: XMLHttpRequest, name: string, value: string): void {
        if (typeof name === 'string' && name.toLowerCase() === 'traceparent') {
            const state = xhrState.get(this);
            if (state) state.hasAppTraceparent = true;
        }
        return original.call(this, name, value);
    };
}

/** Patch `send` to open the span, inject `traceparent`, and end on `readyState === 4`. */
export function createXHRSend(tracer: HttpTracer, original: XhrSend, origin: string): XhrSend {
    return function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null): void {
        const send = (): void => original.call(this, body);

        const config = tracer.config;
        const state = xhrState.get(this);
        if (!config.enableTracing || !state) return send();
        // A completed request whose XHR is re-sent without a fresh open() would start a
        // second span the native send() then rejects (InvalidStateError); pass it through.
        if (state.ended) return send();
        if (isFlareIngestUrl(state.url, origin, config)) return send();

        const abs = safeAbsolute(state.url, origin);
        const pathname = abs ? abs.pathname : state.url;
        const span = tracer.startSpan(`${state.method} ${pathname}`, {
            spanType: 'browser_xhr',
            attributes: requestSpanAttributes(state.method, abs, state.url, config),
        });
        state.span = span;

        if (
            !state.hasAppTraceparent &&
            shouldPropagate(abs ? abs.href : state.url, origin, config.tracePropagationTargets)
        ) {
            try {
                this.setRequestHeader('traceparent', buildTraceparent(span.traceId, span.spanId, span.isRecording));
            } catch {
                // setRequestHeader throws unless the request is in the OPENED state; ignore.
            }
        }

        const onDone = (): void => {
            if (this.readyState !== 4) return;
            this.removeEventListener('readystatechange', onDone);
            if (state.ended) return;
            state.ended = true;
            let status = 0;
            try {
                status = this.status;
            } catch {
                // Reading status can throw on some platforms; treat as 0 (no response).
            }
            try {
                span.setAttribute('http.response.status_code', status);
                // XHR status 0 at readyState 4 always means network/CORS failure or abort (unlike an
                // opaque no-cors fetch response, which is status 0 but not an error), so map it to error.
                if (status === 0 || status >= 500) span.setStatus({ code: 2 });
                span.end();
            } catch {
                // Instrumentation must never throw into the host app.
            }
        };
        this.addEventListener('readystatechange', onDone);

        try {
            return send();
        } catch (error) {
            // The DONE listener never fires on a synchronous send throw, so remove it
            // here to keep the happy path's cleanup symmetric (no listener left dangling).
            this.removeEventListener('readystatechange', onDone);
            try {
                span.setStatus({ code: 2, message: error instanceof Error ? error.message : String(error) });
                if (!state.ended) {
                    state.ended = true;
                    span.end();
                }
            } catch {
                // Instrumentation must never mask the host app's original error.
            }
            throw error;
        }
    } as XhrSend;
}

// Owns ONE installed flag across all three methods, so a third party wrapping just
// one of them (e.g. `send`) cannot wedge the others. See createPatcher for the
// atomic install/uninstall semantics this fixes (Finding 2: a per-method/single-flag
// design like instrumentFetch's is unsafe once methods share state, since `send`
// depends on state `open` populates).
const patcher = createPatcher();

/**
 * Patch `XMLHttpRequest.prototype` (`open`, `setRequestHeader`, `send`) so outgoing
 * XHR requests are traced. No-op where `XMLHttpRequest` is absent (SSR). Idempotent
 * via `fill`. Reversible via `unpatchXHR`.
 */
export function instrumentXHR(tracer: HttpTracer): void {
    if (patcher.installed) return;

    const g = globalThis as { XMLHttpRequest?: typeof XMLHttpRequest; location?: { origin?: string } };
    const X = g.XMLHttpRequest;
    if (typeof X !== 'function' || !X.prototype) return;

    const origin = g.location?.origin ?? '';
    const proto = X.prototype as unknown as Record<string, unknown>;
    patcher.install(proto, [
        { name: 'open', wrap: (o) => createXHROpen(o as XhrOpen) },
        { name: 'setRequestHeader', wrap: (o) => createXHRSetRequestHeader(o as XhrSetHeader) },
        { name: 'send', wrap: (o) => createXHRSend(tracer, o as XhrSend, origin) },
    ]);
}

/** Restore the original `XMLHttpRequest.prototype` methods. Safe if never patched. */
export function unpatchXHR(): void {
    const g = globalThis as { XMLHttpRequest?: typeof XMLHttpRequest };
    const X = g.XMLHttpRequest;
    if (typeof X !== 'function' || !X.prototype) return;
    patcher.uninstall(X.prototype as unknown as Record<string, unknown>);
}
