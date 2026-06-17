import type { Flare } from '@flareapp/js/browser';

let defaultProvider: (() => Flare) | null = null;

// Called once by the web entry (index.ts) as an import side effect. Registers the
// js-root singleton as the fallback used when no instance is injected.
export function registerDefaultFlare(provider: () => Flare): void {
    // Tripwire: registering a web default while the Electron bridge exists means a renderer
    // pulled the package root (e.g. importing @flareapp/react instead of @flareapp/react/inject,
    // or component-tracking codegen emitting the root specifier). That drags the keyed @flareapp/js
    // singleton and its global side effects into the renderer. Fail loudly rather than silently —
    // a warning here is too easy to miss.
    if (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).__flare) {
        throw new Error(
            '[flare] @flareapp/react (web root) was imported in a renderer where the Electron ' +
                'bridge is present, pulling the keyed @flareapp/js singleton into the renderer. ' +
                'Import @flareapp/react/inject and pass the @flareapp/electron/renderer instance instead.',
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
