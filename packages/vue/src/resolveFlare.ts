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

// Called once by the web entry (index.ts) as an import side effect.
export function registerDefaultFlare(provider: () => Flare): void {
    // Tripwire: a web default registering while the Electron bridge exists means a renderer pulled
    // the package root (e.g. importing @flareapp/vue instead of @flareapp/vue/inject). That drags
    // the keyed @flareapp/js singleton and its global side effects into the renderer.
    if (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).__flare) {
        const message =
            '[flare] @flareapp/vue (web root) was imported in a renderer where the Electron ' +
            'bridge is present, pulling the keyed @flareapp/js singleton into the renderer. ' +
            'Import @flareapp/vue/inject and pass the @flareapp/electron/renderer instance instead.';
        // Dev: throw so the misconfiguration is impossible to miss. Production: warn instead, so a
        // shipped app isn't crashed by a (recoverable) reporting-setup mistake.
        if (isDevMode()) {
            throw new Error(message);
        }
        console.warn(message);
    }
    defaultProvider = provider;
}

// Resolve at WIRING time (plugin install / component setup), never inside a report path.
export function resolveFlare(explicit?: Flare): Flare {
    if (explicit) {
        return explicit;
    }
    if (defaultProvider) {
        return defaultProvider();
    }
    throw new Error(
        '[flare] No Flare instance available. Pass `flare` (e.g. from ' +
            '@flareapp/electron/renderer), or import @flareapp/vue (the package root) ' +
            'to use the @flareapp/js default singleton.',
    );
}
