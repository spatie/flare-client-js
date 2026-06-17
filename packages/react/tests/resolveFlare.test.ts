import { beforeEach, describe, expect, test, vi } from 'vitest';

describe('resolveFlare', () => {
    beforeEach(() => {
        vi.resetModules();
        delete (window as any).__flare;
        vi.restoreAllMocks();
    });

    test('returns the explicit instance when provided', async () => {
        const { resolveFlare } = await import('../src/resolveFlare');
        const explicit = { id: 'explicit' } as any;
        expect(resolveFlare(explicit)).toBe(explicit);
    });

    test('returns the registered default when no explicit instance', async () => {
        const { resolveFlare, registerDefaultFlare } = await import('../src/resolveFlare');
        const def = { id: 'default' } as any;
        registerDefaultFlare(() => def);
        expect(resolveFlare()).toBe(def);
    });

    test('throws a clear error when no instance and no default', async () => {
        const { resolveFlare } = await import('../src/resolveFlare');
        expect(() => resolveFlare()).toThrow(/No Flare instance available/);
    });

    test('registerDefaultFlare THROWS when the electron bridge is already present', async () => {
        (window as any).__flare = { report: () => {} };
        const { registerDefaultFlare } = await import('../src/resolveFlare');
        expect(() => registerDefaultFlare(() => ({}) as any)).toThrow(/\/inject/);
    });

    test('registerDefaultFlare does NOT throw without the bridge', async () => {
        const { registerDefaultFlare } = await import('../src/resolveFlare');
        expect(() => registerDefaultFlare(() => ({}) as any)).not.toThrow();
    });
});
