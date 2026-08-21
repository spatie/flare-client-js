import { currentPath, type NavigationSource, type RouteName } from '../tracing/navigation';
import { instrumentationConfig } from './config';
import { createHandlerSet, createPatchLifecycle, type Unsubscribe } from './handlers';

export type NavigationHandler = {
    /** A navigation began. `path` is already resolved, so a handler never has to read `location` itself. */
    onStart?(opts: { path: string; url?: string; hold?: boolean }): void;
    onRouteName?(route: RouteName): void;
    onSettle?(route: RouteName): void;
    /** The registered source went away, so anything a handler parked against it has to be let go. */
    onUnregister?(): void;
};

// A router integration drives this by hand, so there is nothing to patch. The lifecycle stays anyway:
// two no-op functions buy both instrumentation modules the same shape.
const lifecycle = createPatchLifecycle({ install() {}, uninstall() {} });
const handlers = createHandlerSet<NavigationHandler>(lifecycle);

// No reset-for-tests export here, unlike `request.ts`: `handlers.clear()` would evict the
// permanently-registered tracing handler (see its registration in browserTracing.ts) and break every
// later test in a file.

let navToken: object | null = null;

export function addNavigationHandler(handler: NavigationHandler): Unsubscribe {
    return handlers.add(handler);
}

/**
 * While registered, the caller drives navigation through the returned handle and every registered
 * handler hears it. Last-wins, and a stale handle no-ops, so an HMR-replaced bootstrap cannot tear down
 * a newer registration.
 */
export function registerNavigationSource(): NavigationSource {
    const token = {};
    if (navToken && instrumentationConfig()?.debug) {
        console.debug('Flare: navigation source replaced');
    }
    navToken = token;
    function active(): boolean {
        return navToken === token;
    }

    return {
        startNavigation(opts) {
            if (!active()) {
                return;
            }
            const path = opts?.path ?? currentPath();
            handlers.each((handler) => handler.onStart?.({ path, url: opts?.url, hold: opts?.hold }));
        },
        setActiveRouteName(route) {
            if (!active()) {
                return;
            }
            handlers.each((handler) => handler.onRouteName?.(route));
        },
        settleNavigation(route) {
            if (!active()) {
                return;
            }
            handlers.each((handler) => handler.onSettle?.(route));
        },
        unregister() {
            if (!active()) {
                return;
            }
            navToken = null;
            handlers.each((handler) => handler.onUnregister?.());
        },
    };
}

/** Who holds the registration right now, for a handler that parked state against a source. */
export function activeNavigationToken(): object | null {
    return navToken;
}
