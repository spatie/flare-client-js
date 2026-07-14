import type { Flare } from './browser';

declare const process: { env: Record<string, string | undefined> };

/**
 * `process.env.NODE_ENV` is replaced inline by bundlers. The try/catch keeps a process-less
 * environment safe: treat "undetermined" as production (warn, never crash).
 */
function isDevMode(): boolean {
    try {
        return process.env.NODE_ENV !== 'production';
    } catch {
        return false;
    }
}

/**
 * Builds a per-package Flare resolver: `registerDefaultFlare` (wired once by the web entry) and
 * `resolveFlare` (called at wiring time). Each call holds its own default-provider state. The
 * Electron `__flare` tripwire is parameterized by `packageName`; `injectInstruction` overrides the
 * trailing hint for packages whose guidance differs (e.g. svelte's preprocessor importSource).
 */
export function createFlareResolver(config: { packageName: string; injectInstruction?: string }): {
    registerDefaultFlare(provider: () => Flare): void;
    resolveFlare(explicit?: Flare): Flare;
} {
    const { packageName } = config;
    const injectInstruction =
        config.injectInstruction ??
        `Import ${packageName}/inject and pass the @flareapp/electron/renderer instance instead.`;

    let defaultProvider: (() => Flare) | null = null;

    function registerDefaultFlare(provider: () => Flare): void {
        if (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).__flare) {
            const message =
                `[flare] ${packageName} (web root) was imported in a renderer where the Electron ` +
                'bridge is present, pulling the keyed @flareapp/js singleton into the renderer. ' +
                injectInstruction;
            if (isDevMode()) {
                throw new Error(message);
            }
            console.warn(message);
        }
        defaultProvider = provider;
    }

    function resolveFlare(explicit?: Flare): Flare {
        if (explicit) {
            return explicit;
        }
        if (defaultProvider) {
            return defaultProvider();
        }
        throw new Error(
            '[flare] No Flare instance available. Pass `flare` (e.g. from ' +
                `@flareapp/electron/renderer), or import ${packageName} (the package root) ` +
                'to use the @flareapp/js default singleton.',
        );
    }

    return { registerDefaultFlare, resolveFlare };
}
