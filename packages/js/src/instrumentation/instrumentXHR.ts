import { createPatcher } from '../tracing/createPatcher';
import { hasRequestConsumers, publishRequestStart, type RequestSettle } from './requestBus';

// `XMLHttpRequest.DONE` is 4. We write the number, because the tests run in node, where
// XMLHttpRequest does not exist.
const XHR_DONE = 4;

type XhrOpen = XMLHttpRequest['open'];
type XhrSend = XMLHttpRequest['send'];
type XhrSetHeader = XMLHttpRequest['setRequestHeader'];

type Watched = { settle(result: RequestSettle): void; headers: Record<string, string> | undefined };

type XhrState = {
    method: string;
    url: string;
    /** Header names the app set, in lower case. We never replace a header the app set. */
    appHeaders: Set<string>;
    watched?: Watched;
    onDone?: () => void;
    ended: boolean;
};

// One request runs through open(), setRequestHeader(), send() and readystatechange. We keep the
// state for those steps in a WeakMap, so we add nothing to the XHR object itself. The browser can
// free the entry when it frees the request.
const xhrState = new WeakMap<XMLHttpRequest, XhrState>();

// Drop the listener and the settle callback, or they stay in memory as long as the app keeps the
// XHR. The entry itself stays, because `ended` must still be readable if the app sends again.
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
 * The browser stops a running request when the app calls `open()` again, and no DONE event follows.
 * We must finish the old request here. If we do not, the next DONE event finishes it with the status
 * of the new request.
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

        // Turning the method or the URL into a string can throw. That must not stop the app from
        // opening its request. With no state saved, the later send() publishes nothing.
        try {
            if (method && url != null) {
                xhrState.set(this, {
                    method: String(method).toUpperCase(),
                    url: String(url),
                    appHeaders: new Set(),
                    ended: false,
                });
            } else {
                // The app can reuse this XHR object. Delete the old state, or the next send() uses it.
                xhrState.delete(this);
            }
        } catch {
            xhrState.delete(this);
        }
        return (original as (this: XMLHttpRequest, ...a: unknown[]) => void).apply(this, [method, url, ...rest]);
    } as XhrOpen;
}

/**
 * The browser has no `getRequestHeader`, so this is the only place where we can see which headers
 * the app sets. We need that, because a second call with the same name does not replace the header.
 * The browser joins both values into one broken header.
 */
export function createXHRSetRequestHeader(original: XhrSetHeader): XhrSetHeader {
    return function (this: XMLHttpRequest, name: string, value: string): void {
        // Call the real method first. If it throws, the app's header was never set, so we must still
        // be free to set ours. The error belongs to the app, so we do not catch it.
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
            // setRequestHeader throws when the request is not in the OPENED state.
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
        // The app can call send() again on a finished request. The browser then throws
        // InvalidStateError, so a second start would describe a request that never goes out.
        if (state.ended) {
            return send();
        }

        // This reads the saved URL and the user config, so it can throw. An error here must cost us
        // the instrumentation, never the request.
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
                // Reading status can throw on some platforms. Then we treat it as no response.
            }
            settleOnce(state, { status });
        };
        this.addEventListener('readystatechange', onDone);
        state.onDone = onDone;

        try {
            return send();
        } catch (error) {
            // When send() throws right away, no DONE event follows. Remove the listener here.
            this.removeEventListener('readystatechange', onDone);
            settleOnce(state, { error });
            throw error;
        }
    } as XhrSend;
}

const patcher = createPatcher<XMLHttpRequest>();

// We must remove our patch from the same prototype we patched. Something can replace
// XMLHttpRequest after we start, and then `installed` would stay true forever.
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
    // Only forget the prototype when the real methods are back. If another library blocked us, we
    // keep it, so a later try still finds the right prototype.
    if (!patcher.installed) {
        patchedPrototype = null;
    }
}
