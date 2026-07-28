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

const instrumented = new WeakMap<object, () => void>();

/**
 * Instrument `target` at most once at a time, tearing down any prior instrumentation of the same
 * object first. Vite HMR re-runs boot code against a router that survives the reload; without this
 * every cycle would append another listener set that is never removed. Keyed on the object, so a
 * genuinely new router is unaffected. Returns a cleanup that runs `install`'s teardown and
 * deregisters, unless a newer instrumentation already replaced it.
 */
export function instrumentOnce<T extends object>(target: T, install: () => () => void): () => void {
    instrumented.get(target)?.();

    const teardown = install();

    const cleanup = (): void => {
        safeInvoke(teardown);
        if (instrumented.get(target) === cleanup) {
            instrumented.delete(target);
        }
    };

    instrumented.set(target, cleanup);
    return cleanup;
}
