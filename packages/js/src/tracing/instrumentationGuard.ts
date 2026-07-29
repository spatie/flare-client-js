// The most important rule every instrumentation callback has to follow: a throw from our tracing SDK
// can never reach the host (aka our code MAY NEVER crash the app)

/** For a callback the host invokes: a router guard, a store subscriber, ... */
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
 * Instrument `target` at most once at a time, tearing down any prior instrumentation of the same object
 * first. Vite HMR re-runs boot code against a router that survives the reload, so without this every
 * cycle appends another listener set that is never removed. Keyed on the object, so a genuinely new
 * router is unaffected.
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
