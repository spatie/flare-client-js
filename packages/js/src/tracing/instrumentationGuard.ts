// Pure, environment-agnostic guards shared by the framework router integrations. They encode the one
// rule every host-invoked instrumentation callback must obey: a tracing throw can never escape into the
// host's dispatch. Exported from the side-effect-free '@flareapp/js/browser' barrel.

/** Wrap a host-invoked callback (router guard / store subscriber) so a tracing throw can never escape
 *  into the host's dispatch. A thrown callback resolves to `undefined`. */
export function insulate<A extends unknown[]>(fn: (...a: A) => void): (...a: A) => void {
    return (...a: A): void => {
        try {
            fn(...a);
        } catch {
            // instrumentation never breaks the host
        }
    };
}

/** Invoke a teardown fn now (if present), swallowing any throw. For cleanup chains. */
export function safeInvoke(fn: (() => void) | null | undefined): void {
    try {
        fn?.();
    } catch {
        // ignore
    }
}
