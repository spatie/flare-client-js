import { beforeEach, describe, expect, test, vi } from 'vitest';

describe('resolveFlare', () => {
    beforeEach(() => {
        vi.resetModules();
        delete (window as any).__flare;
        vi.restoreAllMocks();
    });

    test('returns the explicit instance when provided', async () => {
        const { resolveFlare } = await import('../src/resolveFlare.js');
        const explicit = { id: 'explicit' } as any;
        expect(resolveFlare(explicit)).toBe(explicit);
    });

    test('returns the registered default when no explicit instance', async () => {
        const { resolveFlare, registerDefaultFlare } = await import('../src/resolveFlare.js');
        const def = { id: 'default' } as any;
        registerDefaultFlare(() => def);
        expect(resolveFlare()).toBe(def);
    });

    test('throws a clear error when no instance and no default', async () => {
        const { resolveFlare } = await import('../src/resolveFlare.js');
        expect(() => resolveFlare()).toThrow(/No Flare instance available/);
    });

    test('registerDefaultFlare warns when the electron bridge is already present', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        (window as any).__flare = { report: () => {} };
        const { registerDefaultFlare } = await import('../src/resolveFlare.js');
        registerDefaultFlare(() => ({}) as any);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('/inject'));
    });

    test('registerDefaultFlare does NOT warn without the bridge', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { registerDefaultFlare } = await import('../src/resolveFlare.js');
        registerDefaultFlare(() => ({}) as any);
        expect(warn).not.toHaveBeenCalled();
    });
});
