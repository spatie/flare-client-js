import type { Flare } from '@flareapp/js/browser';

declare const process: { env: Record<string, string | undefined> };

let defaultProvider: (() => Flare) | null = null;

// `process.env.NODE_ENV` is replaced inline by bundlers (vite/webpack). The try/catch keeps a
// process-less environment safe: treat "undetermined" as production (warn, never crash).
function isDevMode(): boolean {
    try {
        return process.env.NODE_ENV !== 'production';
    } catch {
        return false;
    }
}

/**
 * Called once by the web entry (index.ts) as an import side effect. Registers the js-root singleton
 * as the fallback used when no instance is injected.
 */
export function registerDefaultFlare(provider: () => Flare): void {
    // Tripwire: registering a web default while the Electron bridge exists means a renderer pulled
    // the package root (e.g. @flareapp/react instead of @flareapp/react/inject, or component-tracking
    // codegen emitting the root specifier), dragging the keyed @flareapp/js singleton and its global
    // side effects into the renderer.
    if (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).__flare) {
        const message =
            '[flare] @flareapp/react (web root) was imported in a renderer where the Electron ' +
            'bridge is present, pulling the keyed @flareapp/js singleton into the renderer. ' +
            'Import @flareapp/react/inject and pass the @flareapp/electron/renderer instance instead.';
        // Dev: throw so the misconfiguration can't be missed. Production: warn, so a shipped app
        // isn't crashed by a recoverable reporting-setup mistake.
        if (isDevMode()) {
            throw new Error(message);
        }
        console.warn(message);
    }
    defaultProvider = provider;
}

/**
 * Resolve at wiring time (boundary construct / handler creation), never inside a report path.
 * Throws so a missing instance fails fast at boot.
 */
export function resolveFlare(explicit?: Flare): Flare {
    if (explicit) {
        return explicit;
    }
    if (defaultProvider) {
        return defaultProvider();
    }
    throw new Error(
        '[flare] No Flare instance available. Pass `flare` (e.g. from ' +
            '@flareapp/electron/renderer), or import @flareapp/react (the package root) ' +
            'to use the @flareapp/js default singleton.',
    );
}
