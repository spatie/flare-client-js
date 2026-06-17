import type { Flare } from '@flareapp/js/browser';

let defaultProvider: (() => Flare) | null = null;

// Called once by the web entry (index.ts) as an import side effect.
export function registerDefaultFlare(provider: () => Flare): void {
    // Tripwire: a web default registering while the Electron bridge exists means a renderer pulled
    // the package root (e.g. importing @flareapp/vue instead of @flareapp/vue/inject). That drags
    // the keyed @flareapp/js singleton and its global side effects into the renderer. Fail loudly.
    if (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).__flare) {
        throw new Error(
            '[flare] @flareapp/vue (web root) was imported in a renderer where the Electron ' +
                'bridge is present, pulling the keyed @flareapp/js singleton into the renderer. ' +
                'Import @flareapp/vue/inject and pass the @flareapp/electron/renderer instance instead.',
        );
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
