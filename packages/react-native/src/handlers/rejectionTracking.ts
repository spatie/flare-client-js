// `__DEV__` is a React Native global (true in dev bundles). Declared here for
// the type-checker; guarded with `typeof` at every use for non-RN environments.
declare const __DEV__: boolean | undefined;

type EnableOptions = {
    allRejections?: boolean;
    onUnhandled?: (id: number, error: unknown) => void;
    onHandled?: (id: number) => void;
};

type RejectionEnabler = (options: EnableOptions) => void;

type HermesInternalLike = {
    enablePromiseRejectionTracker?: (options: EnableOptions) => void;
};

/**
 * The reporters this handler routes rejections to. Mirrors the browser
 * `unhandledrejection` path: Error (or stack-bearing) reasons go to
 * `reportSilently` so the STACK is preserved; only stackless reasons fall back
 * to `reportUnhandledRejection` (string, empty-stack `UnhandledRejection`).
 */
export type RejectionReporter = {
    reportSilently: (error: Error) => void;
    reportUnhandledRejection: (message: string) => void;
};

export type RejectionDeps = {
    // `undefined` => resolve from the active JS engine; `null` => no hook (no-op).
    enable?: RejectionEnabler | null;
};

function inDevMode(): boolean {
    return typeof __DEV__ !== 'undefined' && __DEV__ === true;
}

function describeRejectionReason(reason: unknown): string {
    if (typeof reason === 'string') return reason;
    if (reason && typeof reason === 'object') {
        const message = (reason as { message?: unknown }).message;
        if (typeof message === 'string' && message) return message;
        try {
            return JSON.stringify(reason);
        } catch {
            return 'Unhandled promise rejection (non-serializable reason)';
        }
    }
    return String(reason);
}

function hasStack(reason: unknown): reason is { stack: string } {
    return !!reason && typeof reason === 'object' && typeof (reason as { stack?: unknown }).stack === 'string';
}

/**
 * Route a rejection reason to the reporters, mirroring the browser path so an
 * Error reason keeps its stack trace.
 */
function reportRejection(reporter: RejectionReporter, reason: unknown): void {
    if (reason instanceof Error) {
        reporter.reportSilently(reason);
        return;
    }
    if (hasStack(reason)) {
        const error = new Error(describeRejectionReason(reason));
        error.stack = reason.stack;
        reporter.reportSilently(error);
        return;
    }
    reporter.reportUnhandledRejection(describeRejectionReason(reason));
}

/**
 * Inputs to engine detection. Both default to the live runtime sources; tests
 * inject explicit values (e.g. `requirePolyfill: null`) to drive each branch
 * deterministically — necessary because the `promise` polyfill is hoisted into
 * the test env as a transitive dependency of react-native.
 */
export type RejectionEngineDeps = {
    hermes?: HermesInternalLike | null;
    requirePolyfill?: ((id: string) => unknown) | null;
};

/**
 * Resolve the promise-rejection enabler for the ACTIVE JS engine.
 *
 * - Hermes (RN's default engine since 0.70) tracks rejections on its native
 *   Promise via `global.HermesInternal.enablePromiseRejectionTracker`. The
 *   `promise` npm polyfill is NOT the runtime Promise on Hermes, so the
 *   polyfill's `rejection-tracking.enable()` would hook unused objects and
 *   silently never fire — we must use the Hermes hook here.
 * - JSC / non-Hermes: RN polyfills `global.Promise` with the `promise` package,
 *   so `promise/setimmediate/rejection-tracking.enable()` is the real hook.
 *
 * Returns null when neither is reachable. Exported (with injectable deps) for
 * direct unit testing of the ordering; not re-exported from the package entry.
 */
export function resolveRejectionEnabler(deps: RejectionEngineDeps = {}): RejectionEnabler | null {
    const hermes =
        deps.hermes !== undefined
            ? deps.hermes
            : (globalThis as { HermesInternal?: HermesInternalLike }).HermesInternal;
    if (hermes && typeof hermes.enablePromiseRejectionTracker === 'function') {
        return (options) => hermes.enablePromiseRejectionTracker!(options);
    }

    const req =
        deps.requirePolyfill !== undefined ? deps.requirePolyfill : typeof require !== 'undefined' ? require : null;
    if (req) {
        try {
            const tracker = req('promise/setimmediate/rejection-tracking') as { enable: RejectionEnabler };
            if (tracker && typeof tracker.enable === 'function') {
                return (options) => tracker.enable(options);
            }
        } catch {
            // polyfill not present — fall through to null
        }
    }

    return null;
}

/**
 * Best-effort capture of unhandled promise rejections, engine-aware. RN routes
 * these through its engine's tracker (NOT `window.onunhandledrejection`):
 * `HermesInternal.enablePromiseRejectionTracker` on Hermes, the `promise`
 * polyfill on JSC. Reasons are routed exactly like the browser
 * `unhandledrejection` handler (see `reportRejection`), so Error reasons keep
 * their stack via `reportSilently`.
 *
 * Engine-dependent, NOT version-dependent: if no engine hook is reachable this
 * is a no-op (uncaught throws via ErrorUtils still work) and emits a dev-only
 * debug line; it must never crash. The `enable(...)` invocation is wrapped so a
 * throwing engine hook degrades to no-op instead of propagating.
 *
 * Chaining caveat: enabling REPLACES the engine's current callbacks (RN
 * registers its own dev warning) and neither engine exposes a getter for the
 * previous ones, so we cannot truly chain RN's default. To avoid swallowing that
 * developer signal, `onUnhandled` re-emits a `console.warn` in dev (`__DEV__`).
 *
 * Returns an uninstaller that re-enables with no-op callbacks (no clean disable
 * exists on either engine).
 */
export function installRejectionTracking(reporter: RejectionReporter, deps: RejectionDeps = {}): () => void {
    const enable = deps.enable !== undefined ? deps.enable : resolveRejectionEnabler();
    if (!enable) {
        if (inDevMode()) {
            console.debug('[flare] No promise-rejection hook for this JS engine; rejections not captured.');
        }
        return () => {};
    }

    try {
        enable({
            allRejections: true,
            onUnhandled: (_id, error) => {
                if (inDevMode()) {
                    console.warn('[flare] Unhandled promise rejection:', error);
                }
                reportRejection(reporter, error);
            },
            onHandled: () => {},
        });
    } catch {
        // A throwing engine hook must not crash app startup — degrade to no-op.
        if (inDevMode()) {
            console.debug('[flare] Promise-rejection hook threw on enable; rejections not captured.');
        }
        return () => {};
    }

    return () => {
        try {
            enable({ allRejections: true, onUnhandled: () => {}, onHandled: () => {} });
        } catch {
            // Best-effort teardown; ignore.
        }
    };
}
