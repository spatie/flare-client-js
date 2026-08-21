import { defaultNowNano } from '@flareapp/core';

import { createPatcher } from '../tracing/createPatcher';
import { browserUrlContext, isFlareIngestUrl, safeAbsolute, type UrlContext } from '../tracing/httpRequestSpan';
import { isInternalRequest } from '../tracing/internalRequest';
import { type FetchInput, mergeTraceparentHeader } from '../tracing/propagation';
import { supportsNativeFetch } from '../tracing/supportsNativeFetch';
import { instrumentationConfig } from './config';
import { createHandlerSet, createPatchLifecycle, type Unsubscribe } from './handlers';

export type RequestKind = 'fetch' | 'xhr';

export type RequestContext = {
    kind: RequestKind;
    method: string;
    /** The url as the caller wrote it. */
    url: string;
    /** Resolved against `document.baseURI`, or null when it cannot be parsed. */
    absoluteUrl: URL | null;
    startTimeUnixNano: number;
};

export type RequestResult = {
    /** The HTTP status, or 0 when the request never got a response. */
    status: number;
    /** Set when the request rejected or threw instead of returning a response. */
    error?: unknown;
    /** XHR only: a mid-flight `open()` terminated the request, so there was no DONE and no error. */
    aborted?: true;
    endTimeUnixNano: number;
};

/**
 * Asked once per request, before it goes out. Returns a `traceparent` header value, or null for no
 * header. Exactly one owner, which is tracing: this is the only hook that can change what leaves the
 * browser, and it is deliberately narrow enough that it cannot change anything but that one header.
 */
export type RequestStartHandler = (context: RequestContext) => string | null;

/** Told what happened, after the fact. Any number of these, and none of them can change anything. */
export type RequestSettleHandler = (context: RequestContext, result: RequestResult) => void;

const lifecycle = createPatchLifecycle({ install: installPatches, uninstall: removePatches });
const settleHandlers = createHandlerSet<RequestSettleHandler>(lifecycle);

let startHandler: RequestStartHandler | null = null;
let releaseStart: Unsubscribe | null = null;

/**
 * Claim the one start slot. A second caller is refused rather than queued: two owners would each build
 * a `traceparent` and the second would silently lose, which is worse than never being installed.
 */
export function setRequestStartHandler(handler: RequestStartHandler): Unsubscribe {
    if (startHandler) {
        const config = instrumentationConfig();
        if (config?.debug) {
            console.warn('Flare: a request start handler is already registered; ignoring the second one');
        }
        return () => {};
    }
    startHandler = handler;
    releaseStart = lifecycle.retain();
    return () => {
        if (startHandler !== handler) {
            return;
        }
        startHandler = null;
        releaseStart?.();
        releaseStart = null;
    };
}

export function addRequestSettleHandler(handler: RequestSettleHandler): Unsubscribe {
    return settleHandlers.add(handler);
}

/** Test-only export: drops every handler and releases the patches, so one suite cannot leak into the next. */
export function resetRequestInstrumentationForTests(): void {
    startHandler = null;
    releaseStart?.();
    releaseStart = null;
    settleHandlers.clear();
}

function hasHandlers(): boolean {
    return startHandler !== null || settleHandlers.size > 0;
}

const INLINE_SCHEMES = new Set(['data:', 'blob:']);

/**
 * Build the context for one outgoing request, or null when nothing should see it. Three reasons to
 * drop: the SDK marked the request as its own, it targets a Flare ingest endpoint, or it is a
 * `data:`/`blob:` read that never touches the network. All three live here rather than in one
 * consumer, or the next consumer records the traffic this one correctly ignores.
 */
function openRequest(
    kind: RequestKind,
    request: { method: string; url: string },
    init: RequestInit | undefined,
    urls: UrlContext,
): RequestContext | null {
    if (!hasHandlers() || isInternalRequest(init)) {
        return null;
    }
    const config = instrumentationConfig();
    if (!config) {
        return null;
    }
    const base = urls.base();
    const absoluteUrl = safeAbsolute(request.url, base);
    if (isFlareIngestUrl(absoluteUrl, config, base)) {
        return null;
    }
    if (absoluteUrl && INLINE_SCHEMES.has(absoluteUrl.protocol)) {
        return null;
    }
    return {
        kind,
        method: request.method,
        url: request.url,
        absoluteUrl,
        startTimeUnixNano: defaultNowNano(),
    };
}

function askForTraceparent(context: RequestContext): string | null {
    try {
        return startHandler ? startHandler(context) : null;
    } catch {
        // a throwing owner costs the header, never the request
        return null;
    }
}

/** Settles at most once per request: fetch can reject after resolving, and XHR can abort mid-flight. */
function settleOnce(context: RequestContext): (result: Omit<RequestResult, 'endTimeUnixNano'>) => void {
    let settled = false;
    return (result) => {
        if (settled) {
            return;
        }
        settled = true;
        const full: RequestResult = { ...result, endTimeUnixNano: defaultNowNano() };
        settleHandlers.each((handler) => handler(context, full));
    };
}

function resolveRequest(input: FetchInput, init: RequestInit | undefined): { method: string; url: string } {
    let url: string;
    let method = init?.method;
    if (typeof Request !== 'undefined' && input instanceof Request) {
        url = input.url;
        method = method ?? input.method;
    } else {
        url = typeof input === 'string' ? input : String(input);
    }
    return { method: (method ?? 'GET').toUpperCase(), url };
}

/**
 * Build a fetch replacement that opens a request context per call, injects `traceparent` on
 * propagation-eligible URLs, and settles handlers on completion. Pure factory: `urls` is injected (node
 * test env has no `location` or `document`), so this is unit-testable without a browser.
 */
export function createFetchWrapper(original: typeof fetch, urls: UrlContext): typeof fetch {
    return function (this: unknown, input: FetchInput, init?: RequestInit): Promise<Response> {
        const call = (i?: RequestInit): Promise<Response> =>
            (original as (input: FetchInput, init?: RequestInit) => Promise<Response>).call(this, input, i);

        // Everything up to the handoff reads host-supplied input and user config, so any of it can
        // throw. A throw here costs the trace, never the request. The handoff itself must sit
        // outside the try, or a synchronous throw from `call` gets swallowed by the catch below and
        // retried here, invoking the underlying fetch twice.
        let context: RequestContext | null = null;
        try {
            const resolved = resolveRequest(input, init);
            context = openRequest('fetch', resolved, init, urls);
        } catch {
            context = null;
        }

        if (!context) {
            return call(init);
        }

        // Separate guard from the one above: the context already exists here, so a throw must leave it
        // open and settle normally below. Losing the header only costs backend correlation.
        let finalInit = init;
        try {
            const traceparent = askForTraceparent(context);
            if (traceparent) {
                finalInit = mergeTraceparentHeader(input, init, traceparent);
            }
        } catch {
            finalInit = init;
        }

        const settle = settleOnce(context);

        const finishError = (error: unknown): Promise<never> => {
            settle({ status: 0, error });
            return Promise.reject(error);
        };

        let promise: Promise<Response>;
        try {
            promise = call(finalInit);
        } catch (error) {
            return finishError(error);
        }

        return promise.then((response) => {
            try {
                settle({ status: response.status });
            } catch {
                // `status` is a host getter and can throw. Guard the read so a throwing getter costs
                // the settle, never the host's response.
            }
            return response;
        }, finishError);
    };
}

type FetchGlobals = { fetch?: typeof fetch };

// A wrapper left behind by a failed unpatch stays live and checks hasHandlers() per call, so one
// wrapper in the chain is always enough. See createPatcher for how install and uninstall stay in step.
const fetchPatcher = createPatcher<FetchGlobals>();

// XMLHttpRequest.DONE, spelled out: the unit suite runs in the node environment against a hand-built
// XHR stand-in, where the global constructor does not exist.
const XHR_DONE = 4;

type XhrOpen = XMLHttpRequest['open'];
type XhrSend = XMLHttpRequest['send'];
type XhrSetHeader = XMLHttpRequest['setRequestHeader'];

type XhrState = {
    method: string;
    url: string;
    context?: RequestContext; // set at send; cleared once the request settles
    onDone?: () => void; // the readystatechange listener; set at send; cleared once detached
    hasAppTraceparent: boolean;
    ended: boolean;
};

// One XHR spreads across open() -> setRequestHeader()* -> send() -> readystatechange.
// WeakMap keyed by the instance threads state across those calls without polluting the
// instance; entries are GC'd with the request.
const xhrState = new WeakMap<XMLHttpRequest, XhrState>();

/**
 * Drop the context and listener references once a request is done with them. The entry itself stays in
 * the WeakMap for the re-send `ended` guard, so without this it would keep the context and the listener
 * closure alive for as long as the app holds on to the XHR.
 */
function releaseRequestRefs(state: XhrState): void {
    state.context = undefined;
    state.onDone = undefined;
}

/**
 * Patch `open` to capture method/URL. Bails (records no state) when either is missing.
 * Calling `open()` on an in-flight request ends that prior request's context (marked aborted)
 * and detaches its `readystatechange` listener before the new request's method/URL are captured.
 */
export function createXHROpen(original: XhrOpen): XhrOpen {
    return function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]): void {
        // WHATWG: open() on an in-flight request terminates it with no DONE readystatechange.
        // Leaving the prior context and listener in place would let the next request's DONE settle the
        // prior context with this request's status. Settle it as aborted and detach now.
        const prior = xhrState.get(this);
        if (prior && prior.context && !prior.ended) {
            prior.ended = true;
            if (prior.onDone) {
                this.removeEventListener('readystatechange', prior.onDone);
            }
            settleOnce(prior.context)({ status: 0, aborted: true }); // aborted: no HTTP response was received
            releaseRequestRefs(prior);
        }

        // Stringifying a hostile method or URL can throw, and that must not stop the host's request
        // from being opened. Recording no state is enough: the later send() then traces nothing.
        try {
            if (method && url != null) {
                xhrState.set(this, {
                    method: String(method).toUpperCase(),
                    url: String(url),
                    hasAppTraceparent: false,
                    ended: false,
                });
            } else {
                // Clear prior entry so a reused instance can't resurrect stale state on a later send().
                xhrState.delete(this);
            }
        } catch {
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
            if (state) {
                state.hasAppTraceparent = true;
            }
        }
    };
}

function setTraceparentHeader(xhr: XMLHttpRequest, traceparent: string | null | undefined): void {
    if (!traceparent) {
        return;
    }
    try {
        xhr.setRequestHeader('traceparent', traceparent);
    } catch {
        // setRequestHeader throws unless the request is in the OPENED state; ignore.
    }
}

/** Patch `send` to open the request context, inject `traceparent`, and settle on `readyState === 4`. */
export function createXHRSend(original: XhrSend, urls: UrlContext): XhrSend {
    return function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null): void {
        const send = (): void => original.call(this, body);

        const state = xhrState.get(this);
        if (!state || !hasHandlers()) {
            return send();
        }
        // A completed request whose XHR is re-sent without a fresh open() would start a
        // second request the native send() then rejects (InvalidStateError); pass it through.
        if (state.ended) {
            return send();
        }

        // Context setup reads the captured URL and config, so any of it can throw. A throw here costs
        // the trace, never the request: fall through and send untraced, like an ingest URL does.
        let context: RequestContext | null = null;
        try {
            context = openRequest('xhr', { method: state.method, url: state.url }, undefined, urls);
        } catch {
            context = null;
        }
        if (!context) {
            return send();
        }
        state.context = context;

        if (!state.hasAppTraceparent) {
            // Guarded separately from the context setup above: the context already exists, so a
            // throwing owner costs the header only. The request still settles, so it ends with a real
            // status on DONE.
            let traceparent: string | null = null;
            try {
                traceparent = askForTraceparent(context);
            } catch {
                // no traceparent on this request
            }
            setTraceparentHeader(this, traceparent);
        }

        const settle = settleOnce(context);

        const onDone = (): void => {
            if (this.readyState !== XHR_DONE) {
                return;
            }
            this.removeEventListener('readystatechange', onDone);
            if (state.ended) {
                return;
            }
            state.ended = true;
            let status = 0;
            try {
                status = this.status;
            } catch {
                // Reading status can throw on some platforms; treat as 0 (no response).
            }
            settle({ status });
            releaseRequestRefs(state);
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
            settle({ status: 0, error });
            releaseRequestRefs(state);
            throw error;
        }
    } as XhrSend;
}

const xhrPatcher = createPatcher<XMLHttpRequest>();

// Must target the patched prototype for uninstall; a swapped-in constructor would send
// uninstall at the wrong prototype, leaving `installed` true forever.
let patchedPrototype: XMLHttpRequest | null = null;

/**
 * Patch the global `fetch` so outgoing requests are instrumented. No-op when there is no `fetch` or it
 * is not native (a polyfilled/XHR-backed fetch is left for the XHR patch). Idempotent via `fill`.
 */
function installFetchPatch(): void {
    if (fetchPatcher.installed) {
        return;
    }

    const globals = globalThis as FetchGlobals;
    if (typeof globals.fetch !== 'function') {
        return;
    }
    if (!supportsNativeFetch()) {
        return;
    }

    const urls = browserUrlContext();
    fetchPatcher.install(globals, { fetch: (original) => createFetchWrapper(original, urls) });
}

/** Restore the original global `fetch`. Safe if never patched. */
function removeFetchPatch(): void {
    fetchPatcher.uninstall(globalThis as FetchGlobals);
}

/**
 * Patch `XMLHttpRequest.prototype` (`open`, `setRequestHeader`, `send`) so outgoing
 * XHR requests are instrumented. No-op where `XMLHttpRequest` is absent (SSR). Idempotent
 * via `fill`.
 */
function installXHRPatch(): void {
    if (xhrPatcher.installed) {
        return;
    }

    const globals = globalThis as { XMLHttpRequest?: typeof XMLHttpRequest };
    const xhrConstructor = globals.XMLHttpRequest;
    if (typeof xhrConstructor !== 'function' || !xhrConstructor.prototype) {
        return;
    }

    const urls = browserUrlContext();
    xhrPatcher.install(xhrConstructor.prototype, {
        open: (original) => createXHROpen(original),
        setRequestHeader: (original) => createXHRSetRequestHeader(original),
        send: (original) => createXHRSend(original, urls),
    });
    patchedPrototype = xhrConstructor.prototype;
}

/** Restore the original `XMLHttpRequest.prototype` methods. Safe if never patched. */
function removeXHRPatch(): void {
    if (!patchedPrototype) {
        return;
    }
    xhrPatcher.uninstall(patchedPrototype);
    // Only forget the target once it really came back; a blocked uninstall (a third party wrapped
    // ours) must keep it so a later retry still aims at the right prototype.
    if (!xhrPatcher.installed) {
        patchedPrototype = null;
    }
}

function installPatches(): void {
    installFetchPatch();
    installXHRPatch();
}

function removePatches(): void {
    removeFetchPatch();
    removeXHRPatch();
}
