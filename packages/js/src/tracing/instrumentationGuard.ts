// The most important rule every instrumentation callback has to follow: a throw from our tracing SDK
// can never reach the host (aka our code MAY NEVER crash the app)

/** For a callback the host invokes: a router guard, a store subscriber, ... */
export function insulate<A extends unknown[]>(fn: (...a: A) => void): (...a: A) => void {
    return (...args: A): void => {
        try {
            fn(...args);
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

/** Hands one teardown to `instrumentOnce`. Accepts nothing, for a listener an install chose to skip. */
export type TrackTeardown = (teardown: (() => void) | null | undefined) => void;

/**
 * Instrument `target` at most once at a time, tearing down any prior instrumentation of the same object
 * first. Vite HMR re-runs boot code against a router that survives the reload, so without this every
 * cycle appends another listener set that is never removed. Keyed on the object, so a genuinely new
 * router is unaffected.
 *
 * `install` hands each teardown to `track` as it produces it. A router's own `subscribe` / `on` / guard
 * registration can throw, and `install` runs during the host's bootstrap, so a throw part-way through
 * unwinds what already succeeded (newest first) and stops here rather than reaching the host.
 *
 * @returns the cleanup, or a no-op when the install failed and already unwound itself.
 */
export function instrumentOnce<T extends object>(target: T, install: (track: TrackTeardown) => void): () => void {
    instrumented.get(target)?.();

    const teardowns: Array<(() => void) | null | undefined> = [];
    function unwind(): void {
        for (let i = teardowns.length - 1; i >= 0; i--) {
            safeInvoke(teardowns[i]);
        }
    }

    try {
        install((teardown) => {
            teardowns.push(teardown);
        });
    } catch {
        unwind();
        return () => {};
    }

    function cleanup(): void {
        unwind();
        if (instrumented.get(target) === cleanup) {
            instrumented.delete(target);
        }
    }

    instrumented.set(target, cleanup);
    return cleanup;
}
