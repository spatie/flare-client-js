import type { Flare } from '@flareapp/js/browser';

let defaultProvider: (() => Flare) | null = null;

// Called once by the web entry (index.ts) as an import side effect. Registers the
// js-root singleton as the fallback used when no instance is injected.
export function registerDefaultFlare(provider: () => Flare): void {
    // Tripwire: registering a web default while the electron bridge exists means the
    // renderer pulled the package root. It must import `@flareapp/react/inject` instead.
    if (typeof window !== 'undefined' && (window as Record<string, unknown>).__flare) {
        console.warn(
            '[flare] @flareapp/js default registered while the electron bridge is present. ' +
                'In a renderer, import @flareapp/react/inject and pass the ' +
                '@flareapp/electron/renderer instance instead.',
        );
    }
    defaultProvider = provider;
}

// Resolve at WIRING time (boundary construct / handler creation), never inside a
// report path. Throws here so a missing instance fails fast at boot.
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
