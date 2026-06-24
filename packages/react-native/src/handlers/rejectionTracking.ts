import { routeRejection, type RejectionReporter } from '@flareapp/core';

import { inDevMode } from '../devMode';

type EnableOptions = {
    allRejections?: boolean;
    onUnhandled?: (id: number, error: unknown) => void;
    onHandled?: (id: number) => void;
};

type RejectionEnabler = (options: EnableOptions) => void;

type HermesInternalLike = {
    enablePromiseRejectionTracker?: (options: EnableOptions) => void;
};

// The reporter shape and reason-routing (Error/stack-bearing -> reportSilently,
// stackless -> reportUnhandledRejection) are shared with the browser listener;
// they live in `@flareapp/core` (`routeRejection`) so the two SDKs cannot drift.
export type { RejectionReporter };

export type RejectionDeps = {
    // `undefined` => resolve from the active JS engine; `null` => no hook (no-op).
    enable?: RejectionEnabler | null;
};

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
 * `unhandledrejection` handler (core's `routeRejection`), so Error reasons keep
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
                routeRejection(reporter, error);
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
