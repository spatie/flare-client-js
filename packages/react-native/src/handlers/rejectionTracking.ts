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

// Reporter shape and reason-routing (stack-bearing -> reportSilently, stackless -> reportUnhandledRejection)
// live in `@flareapp/core` (`routeRejection`), shared with the browser listener so the SDKs can't drift.
export type { RejectionReporter };

export type RejectionDeps = {
    // `undefined` => resolve from the active JS engine; `null` => no hook (no-op).
    enable?: RejectionEnabler | null;
};

/**
 * Inputs to engine detection. Both default to the live runtime sources; tests inject explicit values (e.g.
 * `requirePolyfill: null`) to drive each branch deterministically, since the `promise` polyfill is hoisted
 * into the test env as a transitive dependency of react-native.
 */
export type RejectionEngineDeps = {
    hermes?: HermesInternalLike | null;
    requirePolyfill?: ((id: string) => unknown) | null;
};

/**
 * Resolve the promise-rejection enabler for the active JS engine, null when neither is reachable.
 *
 * - Hermes (RN's default since 0.70): tracks on its native Promise via
 *   `global.HermesInternal.enablePromiseRejectionTracker`. The `promise` npm polyfill is not the runtime
 *   Promise here, so its `rejection-tracking.enable()` would hook unused objects and never fire.
 * - JSC / non-Hermes: RN polyfills `global.Promise` with the `promise` package, so
 *   `promise/setimmediate/rejection-tracking.enable()` is the real hook.
 *
 * Exported (with injectable deps) for unit-testing the ordering; not re-exported from the package entry.
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
            // polyfill not present; fall through to null
        }
    }

    return null;
}

/**
 * Best-effort, engine-aware capture of unhandled promise rejections. RN routes these through the engine's
 * tracker (not `window.onunhandledrejection`): `HermesInternal.enablePromiseRejectionTracker` on Hermes,
 * the `promise` polyfill on JSC. Reasons route like the browser handler (core's `routeRejection`), so Error
 * reasons keep their stack via `reportSilently`.
 *
 * If no engine hook is reachable this is a no-op (uncaught throws via ErrorUtils still work) with a dev-only
 * debug line; it must never crash. The `enable(...)` call is wrapped so a throwing hook degrades to no-op.
 *
 * Chaining caveat: enabling replaces the engine's current callbacks (RN registers its own dev warning) and
 * neither engine exposes a getter for the previous ones, so we can't chain RN's default. To avoid swallowing
 * that signal, `onUnhandled` re-emits a `console.warn` in dev.
 *
 * Returns an uninstaller that re-enables with no-op callbacks (no clean disable exists on either engine).
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
        // A throwing engine hook must not crash app startup; degrade to no-op.
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
