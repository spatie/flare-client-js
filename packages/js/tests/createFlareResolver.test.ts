// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFlareResolver } from '../src/createFlareResolver';

const fakeFlare = () => ({}) as never;

afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__flare;
});

describe('createFlareResolver', () => {
    it('resolves an explicit instance, then the registered default, else throws', () => {
        const { registerDefaultFlare, resolveFlare } = createFlareResolver({ packageName: '@flareapp/react' });
        const explicit = fakeFlare();
        expect(resolveFlare(explicit)).toBe(explicit);
        expect(() => resolveFlare()).toThrow(/No Flare instance available/);
        const def = fakeFlare();
        registerDefaultFlare(() => def);
        expect(resolveFlare()).toBe(def);
    });

    it('warns (not throws) in production when the Electron bridge is present', () => {
        (window as unknown as Record<string, unknown>).__flare = {};
        process.env.NODE_ENV = 'production';
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { registerDefaultFlare } = createFlareResolver({ packageName: '@flareapp/react' });
        registerDefaultFlare(() => fakeFlare());
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('@flareapp/react/inject'));
        warn.mockRestore();
    });

    it('uses a custom injectInstruction verbatim', () => {
        (window as unknown as Record<string, unknown>).__flare = {};
        process.env.NODE_ENV = 'production';
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { registerDefaultFlare } = createFlareResolver({
            packageName: '@flareapp/svelte',
            injectInstruction: 'CUSTOM-HINT',
        });
        registerDefaultFlare(() => fakeFlare());
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('CUSTOM-HINT'));
        warn.mockRestore();
    });
});
