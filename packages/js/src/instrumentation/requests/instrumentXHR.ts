import { createPatcher } from '../../tracing/utils/createPatcher';
import { hasRequestSubscribers, publishRequestStart } from './requestBus';
import type { RequestSettle } from './types';

// `XMLHttpRequest.DONE`, written out because the tests run in node where XMLHttpRequest does not exist.
const XHR_DONE = 4;

type XhrOpen = XMLHttpRequest['open'];
type XhrSend = XMLHttpRequest['send'];
type XhrSetHeader = XMLHttpRequest['setRequestHeader'];

type Watched = { settle(result: RequestSettle): void; headers: Record<string, string> | undefined };

type XhrState = {
    method: string;
    url: string;
    // Header names the app set, in lower case. We never replace a header the app set.
    appHeaders: Set<string>;
    watched?: Watched;
    onDone?: () => void;
    ended: boolean;
};

// Per-request state across open(), setRequestHeader(), send() and readystatechange. A WeakMap so we
// add nothing to the XHR object itself.
const xhrState = new WeakMap<XMLHttpRequest, XhrState>();

// Drop the listener and settle callback so they cannot leak while the app keeps the XHR. The entry
// itself stays: `ended` must still be readable if the app sends again.
function releaseRequestRefs(state: XhrState): void {
    state.watched = undefined;
    state.onDone = undefined;
}

function settleOnce(state: XhrState, result: RequestSettle): void {
    state.ended = true;
    state.watched?.settle(result);
    releaseRequestRefs(state);
}

// A second open() stops a running request without a DONE event, so the old request must settle here.
// Otherwise the next DONE event would finish it with the status of the new request.
export function createXHROpen(original: XhrOpen): XhrOpen {
    return function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]): void {
        const prior = xhrState.get(this);
        if (prior && prior.watched && !prior.ended) {
            if (prior.onDone) {
                this.removeEventListener('readystatechange', prior.onDone);
            }
            settleOnce(prior, { aborted: true });
        }

        // String(method) or String(url) can throw. That must not stop the app's open(); with no
        // state saved, the later send() simply publishes nothing.
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

// There is no getRequestHeader, so this is the only place to see which headers the app sets. We must
// know: setting the same header twice does not replace it, the browser joins both values.
export function createXHRSetRequestHeader(original: XhrSetHeader): XhrSetHeader {
    return function (this: XMLHttpRequest, name: string, value: string): void {
        // Real method first: if it throws, the app's header was never set and we stay free to set ours.
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
        if (!state || !hasRequestSubscribers()) {
            return send();
        }
        // send() on a finished request throws InvalidStateError, so a second start would describe a
        // request that never goes out.
        if (state.ended) {
            return send();
        }

        // An error here must cost us the instrumentation, never the request.
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
            // A synchronous throw means no DONE event will follow.
            this.removeEventListener('readystatechange', onDone);
            settleOnce(state, { error });
            throw error;
        }
    } as XhrSend;
}

const patcher = createPatcher<XMLHttpRequest>();

// Uninstall must target the prototype we patched: something can replace XMLHttpRequest after we start.
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
    // Only forget the prototype once the real methods are back, so a later try still finds it.
    if (!patcher.installed) {
        patchedPrototype = null;
    }
}
