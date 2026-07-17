import { type Span } from '@flareapp/core';

import { createPatcher } from './createPatcher';
import {
    endHttpRequestSpan,
    finishHttpSpanError,
    type HttpTracer,
    isFlareIngestUrl,
    requestSpanAttributes,
    safeAbsolute,
    traceparentFor,
} from './httpRequestSpan';
import { BrowserSpanType } from './spanTypes';

type XhrOpen = XMLHttpRequest['open'];
type XhrSend = XMLHttpRequest['send'];
type XhrSetHeader = XMLHttpRequest['setRequestHeader'];

type XhrState = {
    method: string;
    url: string;
    span?: Span; // set at send; nulled once the span ends (Finding 9: no dangling Span ref)
    onDone?: () => void; // the readystatechange listener; set at send; nulled once detached
    hasAppTraceparent: boolean;
    ended: boolean;
};

// One XHR spreads across open() -> setRequestHeader()* -> send() -> readystatechange.
// WeakMap keyed by the instance threads state across those calls without polluting the
// instance; entries are GC'd with the request.
const xhrState = new WeakMap<XMLHttpRequest, XhrState>();

/**
 * Patch `open` to capture method/URL. Bails (records no state) when either is missing.
 * Calling `open()` on an in-flight request ends that prior request's span (marked aborted)
 * and detaches its `readystatechange` listener before the new request's method/URL are captured.
 */
export function createXHROpen(original: XhrOpen): XhrOpen {
    return function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]): void {
        // WHATWG: open() on an in-flight request terminates it with no DONE readystatechange.
        // Leaving the prior span/listener in place would let the next request's DONE cross-end
        // the prior span with this one's status (Finding 1). End it as aborted and detach now.
        const prior = xhrState.get(this);
        if (prior && prior.span && !prior.ended) {
            prior.ended = true;
            if (prior.onDone) this.removeEventListener('readystatechange', prior.onDone);
            try {
                prior.span.setStatus({ code: 2 }); // aborted: no HTTP response was received
                prior.span.end();
            } catch {
                // Instrumentation must never throw into the host app.
            }
            prior.span = undefined;
            prior.onDone = undefined;
        }

        if (method && url != null) {
            const urlStr = String(url);
            xhrState.set(this, {
                method: String(method).toUpperCase(),
                url: urlStr,
                hasAppTraceparent: false,
                ended: false,
            });
        } else {
            // Clear prior entry so a reused instance can't resurrect stale state on a later send().
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
        // Call native setRequestHeader first: if it throws (e.g. forbidden header value) the app's
        // header never landed, so don't record hasAppTraceparent, else send() suppresses Flare's
        // injection and the request carries no traceparent at all. The throw is the app's; propagate it.
        original.call(this, name, value);
        if (typeof name === 'string' && name.toLowerCase() === 'traceparent') {
            const state = xhrState.get(this);
            if (state) state.hasAppTraceparent = true;
        }
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

        const abs = safeAbsolute(state.url, origin);
        if (isFlareIngestUrl(abs, config)) return send();

        const pathname = abs ? abs.pathname : state.url;
        const span = tracer.startSpan(`${state.method} ${pathname}`, {
            spanType: BrowserSpanType.Xhr,
            attributes: requestSpanAttributes(state.method, abs, state.url, config),
        });
        state.span = span;

        if (!state.hasAppTraceparent) {
            const tp = traceparentFor(span, abs, state.url, origin, config);
            if (tp) {
                try {
                    this.setRequestHeader('traceparent', tp);
                } catch {
                    // setRequestHeader throws unless the request is in the OPENED state; ignore.
                }
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
                // status 0 at DONE means "no HTTP response" (network/CORS failure/abort) only for
                // http(s). file:// and custom schemes (e.g. Electron registerFileProtocol) return 0
                // on success, so don't map to error. A null `abs` (unparseable URL) also isn't error.
                const zeroIsError = abs !== null && (abs.protocol === 'http:' || abs.protocol === 'https:');
                endHttpRequestSpan(span, status, { zeroIsError });
            } catch {
                // Instrumentation must never throw into the host app.
            }
            // Release refs so the WeakMap entry (kept for the re-send `ended` guard) no longer
            // pins the Span or this closure (Finding 9).
            state.span = undefined;
            state.onDone = undefined;
        };
        this.addEventListener('readystatechange', onDone);
        state.onDone = onDone;

        try {
            return send();
        } catch (error) {
            // The DONE listener never fires on a synchronous send throw, so remove it here
            // (no listener left dangling).
            this.removeEventListener('readystatechange', onDone);
            state.ended = true;
            try {
                finishHttpSpanError(span, error);
            } catch {
                // Instrumentation must never mask the host app's original error.
            }
            // Same ref-release as the DONE path (Finding 9). The throw below still leaves the
            // WeakMap entry in place for the re-send `ended` guard.
            state.span = undefined;
            state.onDone = undefined;
            throw error;
        }
    } as XhrSend;
}

// Owns one installed flag across all three methods, so a third party wrapping just one
// (e.g. `send`) cannot wedge the others. See createPatcher for the atomic install/uninstall
// semantics (Finding 2: a per-method single-flag design is unsafe once methods share state,
// since `send` depends on state `open` populates).
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
