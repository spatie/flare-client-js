import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// process is ambiently typed without NODE_ENV in this package; cast to a mutable env map.
const procEnv = (process as unknown as { env: Record<string, string | undefined> }).env;

describe('resolveFlare', () => {
    const originalNodeEnv = procEnv.NODE_ENV;

    beforeEach(() => {
        vi.resetModules();
        delete (window as any).__flare;
        vi.restoreAllMocks();
    });

    afterEach(() => {
        procEnv.NODE_ENV = originalNodeEnv;
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

    test('registerDefaultFlare THROWS in dev when the electron bridge is already present', async () => {
        procEnv.NODE_ENV = 'development';
        (window as any).__flare = { report: () => {} };
        const { registerDefaultFlare } = await import('../src/resolveFlare.js');
        expect(() => registerDefaultFlare(() => ({}) as any)).toThrow(/\/inject/);
    });

    test('registerDefaultFlare WARNS (does not throw) in production when the bridge is present', async () => {
        procEnv.NODE_ENV = 'production';
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        (window as any).__flare = { report: () => {} };
        const { registerDefaultFlare } = await import('../src/resolveFlare.js');
        expect(() => registerDefaultFlare(() => ({}) as any)).not.toThrow();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('/inject'));
    });

    test('registerDefaultFlare does NOT throw or warn without the bridge', async () => {
        procEnv.NODE_ENV = 'development';
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { registerDefaultFlare } = await import('../src/resolveFlare.js');
        expect(() => registerDefaultFlare(() => ({}) as any)).not.toThrow();
        expect(warn).not.toHaveBeenCalled();
    });
});
