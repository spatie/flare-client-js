/** True if `fn` is the browser's native fetch (not a polyfill/wrapper). */
export function isNativeFetch(fn: unknown): boolean {
    return typeof fn === 'function' && /native code/.test(Function.prototype.toString.call(fn));
}

/**
 * Whether the current global `fetch` is native. A polyfilled fetch (e.g. whatwg-fetch) is
 * XHR-backed; skip instrumenting it so the XHR patch is the single source for those requests.
 * Ported from Sentry, including the hidden-iframe fallback used when another library has already
 * wrapped `fetch` and the direct toString check is unreliable.
 */
export function supportsNativeFetch(): boolean {
    const globals = globalThis as { fetch?: unknown; document?: Document };
    if (typeof globals.fetch !== 'function') {
        return false;
    }
    if (isNativeFetch(globals.fetch)) {
        return true;
    }

    // Browser-only fallback: read an untouched fetch from a detached iframe.
    // Not exercised by the node-env unit tests.
    let result = false;
    const document = globals.document;
    if (document && typeof document.createElement === 'function') {
        try {
            const sandbox = document.createElement('iframe');
            sandbox.hidden = true;
            document.head.appendChild(sandbox);
            const sandboxWindow = sandbox.contentWindow as (Window & { fetch?: unknown }) | null;
            if (sandboxWindow && typeof sandboxWindow.fetch === 'function') {
                result = isNativeFetch(sandboxWindow.fetch);
            }
            document.head.removeChild(sandbox);
        } catch {
            result = false;
        }
    }
    return result;
}
