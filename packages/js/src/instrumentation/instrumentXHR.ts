import { createPatcher } from '../tracing/createPatcher';
import { hasRequestConsumers, publishRequestStart, type RequestSettle } from './requestBus';

// Spelled out because the unit suite runs in node against a hand-built XHR stand-in, where the
// global constructor does not exist.
const XHR_DONE = 4;

type XhrOpen = XMLHttpRequest['open'];
type XhrSend = XMLHttpRequest['send'];
type XhrSetHeader = XMLHttpRequest['setRequestHeader'];

type Watched = { settle(result: RequestSettle): void; headers: Record<string, string> | undefined };

type XhrState = {
    method: string;
    url: string;
    /** Lowercased names the app set itself. The caller always wins over a consumer. */
    appHeaders: Set<string>;
    watched?: Watched;
    onDone?: () => void;
    ended: boolean;
};

// One XHR runs across open() -> setRequestHeader()* -> send() -> readystatechange. A WeakMap keyed
// by the instance carries state across those calls without touching the instance, and entries go
// away with the request.
const xhrState = new WeakMap<XMLHttpRequest, XhrState>();

// The entry itself stays for the re-send `ended` guard, so without this the listener closure lives
// as long as the app holds the XHR.
function releaseRequestRefs(state: XhrState): void {
    state.watched = undefined;
    state.onDone = undefined;
}

function settleOnce(state: XhrState, result: RequestSettle): void {
    state.ended = true;
    state.watched?.settle(result);
    releaseRequestRefs(state);
}

/**
 * WHATWG: `open()` on an in-flight request kills it, and no DONE event follows. Settle it here, or
 * the next request's DONE settles this one with the wrong status.
 */
export function createXHROpen(original: XhrOpen): XhrOpen {
    return function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]): void {
        const prior = xhrState.get(this);
        if (prior && prior.watched && !prior.ended) {
            if (prior.onDone) {
                this.removeEventListener('readystatechange', prior.onDone);
            }
            settleOnce(prior, { aborted: true });
        }

        // A hostile method or URL can throw when stringified, and that must not stop the host from
        // opening its request. With no state recorded, the later send() publishes nothing.
        try {
            if (method && url != null) {
                xhrState.set(this, {
                    method: String(method).toUpperCase(),
                    url: String(url),
                    appHeaders: new Set(),
                    ended: false,
                });
            } else {
                // A reused instance must not resurrect stale state on a later send().
                xhrState.delete(this);
            }
        } catch {
            xhrState.delete(this);
        }
        return (original as (this: XMLHttpRequest, ...a: unknown[]) => void).apply(this, [method, url, ...rest]);
    } as XhrOpen;
}

/**
 * There is no `getRequestHeader`, so recording what the app set here is the only way to leave its
 * headers alone later. Repeat calls merge into one malformed header.
 */
export function createXHRSetRequestHeader(original: XhrSetHeader): XhrSetHeader {
    return function (this: XMLHttpRequest, name: string, value: string): void {
        // Native call first: if it throws, the app's header never landed, so we must still be free
        // to set our own. The throw is the app's, so let it through.
        original.call(this, name, value);
        if (typeof name === 'string') {
            xhrState.get(this)?.appHeaders.add(name.toLowerCase());
        }
    };
}

function applyHeaders(xhr: XMLHttpRequest, state: XhrState): void {
    const headers = state.watched?.headers;
    if (!headers) {
        return;
    }
    for (const [name, value] of Object.entries(headers)) {
        if (state.appHeaders.has(name.toLowerCase())) {
            continue;
        }
        try {
            xhr.setRequestHeader(name, value);
        } catch {
            // setRequestHeader throws unless the request is OPENED.
        }
    }
}

export function createXHRSend(original: XhrSend): XhrSend {
    return function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null): void {
        const send = (): void => original.call(this, body);

        const state = xhrState.get(this);
        if (!state || !hasRequestConsumers()) {
            return send();
        }
        // A finished request re-sent without a fresh open() would publish a second start that the
        // native send() then rejects with InvalidStateError.
        if (state.ended) {
            return send();
        }

        // Publishing reads the captured URL and user config, so it can throw. A throw here costs the
        // instrumentation, never the request.
        let watched: Watched | null = null;
        try {
            watched = publishRequestStart({ kind: 'xhr', method: state.method, url: state.url });
        } catch {
            watched = null;
        }
        if (!watched) {
            return send();
        }
        state.watched = watched;

        applyHeaders(this, state);

        const onDone = (): void => {
            if (this.readyState !== XHR_DONE) {
                return;
            }
            this.removeEventListener('readystatechange', onDone);
            if (state.ended) {
                return;
            }
            let status = 0;
            try {
                status = this.status;
            } catch {
                // Reading status can throw on some platforms. Treat it as no response.
            }
            settleOnce(state, { status });
        };
        this.addEventListener('readystatechange', onDone);
        state.onDone = onDone;

        try {
            return send();
        } catch (error) {
            // DONE never fires after a synchronous send throw, so detach here.
            this.removeEventListener('readystatechange', onDone);
            settleOnce(state, { error });
            throw error;
        }
    } as XhrSend;
}

const patcher = createPatcher<XMLHttpRequest>();

// Uninstall must aim at the prototype we patched. A swapped-in constructor would send it elsewhere
// and leave `installed` true forever.
let patchedPrototype: XMLHttpRequest | null = null;

export function instrumentXHR(): void {
    if (patcher.installed) {
        return;
    }

    const globals = globalThis as { XMLHttpRequest?: typeof XMLHttpRequest };
    const xhrConstructor = globals.XMLHttpRequest;
    if (typeof xhrConstructor !== 'function' || !xhrConstructor.prototype) {
        return;
    }

    patcher.install(xhrConstructor.prototype, {
        open: (original) => createXHROpen(original),
        setRequestHeader: (original) => createXHRSetRequestHeader(original),
        send: (original) => createXHRSend(original),
    });
    patchedPrototype = xhrConstructor.prototype;
}

export function unpatchXHR(): void {
    if (!patchedPrototype) {
        return;
    }
    patcher.uninstall(patchedPrototype);
    // Only forget the target once it really came back. A blocked uninstall must keep it, so a later
    // retry still aims at the right prototype.
    if (!patcher.installed) {
        patchedPrototype = null;
    }
}
