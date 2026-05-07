import { describe, expect, test, vi } from 'vitest';

import flareSourcemaps from '../src/index';

describe('flareSourcemaps plugin', () => {
    describe('config hook', () => {
        test('uses JSON.stringify for define values (prevents injection)', () => {
            const plugin = flareSourcemaps({
                apiKey: "key-with-'quote",
                version: "ver-with-'quote",
            }) as any;

            const result = plugin.config({ build: {} }, { mode: 'production' });

            expect(result.define.FLARE_JS_KEY).toBe(JSON.stringify("key-with-'quote"));
            expect(result.define.FLARE_SOURCEMAP_VERSION).toBe(JSON.stringify("ver-with-'quote"));
        });

        test('sets sourcemap to hidden when upload is enabled', () => {
            const plugin = flareSourcemaps({ apiKey: 'test-key' }) as any;

            const result = plugin.config({ build: {} }, { mode: 'production' });

            expect(result.build.sourcemap).toBe('hidden');
        });

        test('disables upload in development mode unless runInDevelopment is true', () => {
            const plugin = flareSourcemaps({ apiKey: 'test-key' }) as any;

            const result = plugin.config({ build: {} }, { mode: 'development' });
            expect(result.build.sourcemap).toBeUndefined();
        });

        test('enables upload in development when runInDevelopment is true', () => {
            const plugin = flareSourcemaps({ apiKey: 'test-key', runInDevelopment: true }) as any;

            const result = plugin.config({ build: {} }, { mode: 'development' });
            expect(result.build.sourcemap).toBe('hidden');
        });
    });

    describe('plugin metadata', () => {
        test('has correct name', () => {
            const plugin = flareSourcemaps({ apiKey: 'test' }) as any;
            expect(plugin.name).toBe('flare-vite-plugin');
        });

        test('applies only to build', () => {
            const plugin = flareSourcemaps({ apiKey: 'test' }) as any;
            expect(plugin.apply).toBe('build');
        });

        test('enforces post order', () => {
            const plugin = flareSourcemaps({ apiKey: 'test' }) as any;
            expect(plugin.enforce).toBe('post');
        });
    });

    describe('missing API key', () => {
        test('warns when no API key provided', () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            flareSourcemaps({ apiKey: '' });

            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('No Flare API key'));
            warnSpy.mockRestore();
        });
    });
});
