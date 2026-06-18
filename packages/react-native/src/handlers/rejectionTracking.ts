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

export type RejectionDeps = {
    // `undefined` => resolve from the active JS engine; `null` => no hook (no-op).
    enable?: RejectionEnabler | null;
};

function inDevMode(): boolean {
    return typeof __DEV__ !== 'undefined' && __DEV__ === true;
}

function messageFromRejection(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
}

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
 * Returns null when neither is reachable.
 */
function resolveRejectionEnabler(): RejectionEnabler | null {
    const hermes = (globalThis as { HermesInternal?: HermesInternalLike }).HermesInternal;
    if (hermes && typeof hermes.enablePromiseRejectionTracker === 'function') {
        return (options) => hermes.enablePromiseRejectionTracker!(options);
    }

    const req: ((id: string) => unknown) | null = typeof require !== 'undefined' ? require : null;
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
 * polyfill on JSC. Reported via core's `reportUnhandledRejection(message)` — the
 * same shaping the browser uses.
 *
 * Engine-dependent, NOT version-dependent: if no engine hook is reachable this
 * is a no-op (uncaught throws via ErrorUtils still work) and emits a dev-only
 * debug line; it must never crash.
 *
 * Chaining caveat: enabling REPLACES the engine's current callbacks (RN
 * registers its own dev warning) and neither engine exposes a getter for the
 * previous ones, so we cannot truly chain RN's default. To avoid swallowing that
 * developer signal, `onUnhandled` re-emits a `console.warn` in dev (`__DEV__`).
 *
 * Returns an uninstaller that re-enables with no-op callbacks (no clean disable
 * exists on either engine).
 */
export function installRejectionTracking(report: (message: string) => void, deps: RejectionDeps = {}): () => void {
    const enable = deps.enable !== undefined ? deps.enable : resolveRejectionEnabler();
    if (!enable) {
        if (inDevMode()) {
            console.debug('[flare] No promise-rejection hook for this JS engine; rejections not captured.');
        }
        return () => {};
    }

    enable({
        allRejections: true,
        onUnhandled: (_id, error) => {
            const message = messageFromRejection(error);
            if (inDevMode()) {
                console.warn('[flare] Unhandled promise rejection:', error);
            }
            report(message);
        },
        onHandled: () => {},
    });

    return () => {
        enable({ allRejections: true, onUnhandled: () => {}, onHandled: () => {} });
    };
}
