import type { Flare } from '@flareapp/js/browser';

let defaultProvider: (() => Flare) | null = null;

// Called once by the web entry (index.ts) as an import side effect.
export function registerDefaultFlare(provider: () => Flare): void {
    // Tripwire: a web default registering while the Electron bridge exists means a renderer pulled
    // the package root — directly, or via component-tracking codegen emitting the root specifier
    // (set the preprocessor's importSource to '@flareapp/svelte/inject' to avoid that). It drags
    // the keyed @flareapp/js singleton and its global side effects into the renderer. Fail loudly.
    if (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).__flare) {
        throw new Error(
            '[flare] @flareapp/svelte (web root) was imported in a renderer where the Electron ' +
                'bridge is present, pulling the keyed @flareapp/js singleton into the renderer. ' +
                'Import @flareapp/svelte/inject (and set the preprocessor importSource to ' +
                "'@flareapp/svelte/inject') instead.",
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
