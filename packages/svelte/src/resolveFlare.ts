import type { Flare } from '@flareapp/js/browser';

let defaultProvider: (() => Flare) | null = null;

// Called once by the web entry (index.ts) as an import side effect.
export function registerDefaultFlare(provider: () => Flare): void {
    if (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).__flare) {
        console.warn(
            '[flare] @flareapp/js default registered while the electron bridge is present. ' +
                'In a renderer, import @flareapp/svelte/inject and pass the ' +
                '@flareapp/electron/renderer instance instead.',
        );
    }
    defaultProvider = provider;
}

// Resolve at WIRING time (handler creation / component setup), never inside a report path.
export function resolveFlare(explicit?: Flare): Flare {
    if (explicit) {
        return explicit;
    }
    if (defaultProvider) {
        return defaultProvider();
    }
    throw new Error(
        '[flare] No Flare instance available. Pass `flare` (e.g. from ' +
            '@flareapp/electron/renderer), or import @flareapp/svelte (the package root) ' +
            'to use the @flareapp/js default singleton.',
    );
}
