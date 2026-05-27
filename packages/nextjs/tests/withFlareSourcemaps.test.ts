import { FlareWebpackPlugin } from '@flareapp/webpack';
import { describe, expect, test, vi } from 'vitest';

import { withFlareSourcemaps } from '../src/withFlareSourcemaps';

vi.mock('@flareapp/webpack', () => ({
    FlareWebpackPlugin: vi.fn(),
}));

describe('withFlareSourcemaps', () => {
    test('returns a valid Next.js config object', () => {
        const config = withFlareSourcemaps({}, { apiKey: 'test-key' });

        expect(config).toHaveProperty('webpack');
        expect(config).toHaveProperty('productionBrowserSourceMaps', true);
    });

    test('preserves existing Next.js config properties', () => {
        const config = withFlareSourcemaps(
            { reactStrictMode: true, images: { domains: ['example.com'] } },
            { apiKey: 'test-key' },
        );

        expect(config.reactStrictMode).toBe(true);
        expect(config.images).toEqual({ domains: ['example.com'] });
    });

    test('does not override productionBrowserSourceMaps if explicitly set to false', () => {
        const config = withFlareSourcemaps({ productionBrowserSourceMaps: false }, { apiKey: 'test-key' });

        expect(config.productionBrowserSourceMaps).toBe(false);
    });

    test('enables experimental.serverSourceMaps by default', () => {
        const config = withFlareSourcemaps({}, { apiKey: 'test-key' });

        expect(config.experimental).toMatchObject({ serverSourceMaps: true });
    });

    test('preserves existing experimental config and explicit serverSourceMaps', () => {
        const config = withFlareSourcemaps(
            { experimental: { serverSourceMaps: false, typedRoutes: true } },
            { apiKey: 'test-key' },
        );

        expect(config.experimental).toMatchObject({ serverSourceMaps: false, typedRoutes: true });
    });

    describe('webpack function', () => {
        test('adds FlareWebpackPlugin to config plugins for client builds', () => {
            const config = withFlareSourcemaps({}, { apiKey: 'test-key' });

            const webpackConfig = { plugins: [] as unknown[] };
            const result = config.webpack!(webpackConfig as any, { isServer: false } as any);

            expect(FlareWebpackPlugin).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'test-key' }));
            expect(result.plugins).toHaveLength(1);
        });

        test('adds FlareWebpackPlugin for server builds', () => {
            const config = withFlareSourcemaps({}, { apiKey: 'test-key' });

            const webpackConfig = { plugins: [] as unknown[] };
            const result = config.webpack!(webpackConfig as any, { isServer: true } as any);

            expect(FlareWebpackPlugin).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'test-key' }));
            expect(result.plugins).toHaveLength(1);
        });

        test('sets devtool to source-map for production server builds', () => {
            const config = withFlareSourcemaps({}, { apiKey: 'test-key' });

            const webpackConfig = { plugins: [] as unknown[] };
            const result = config.webpack!(webpackConfig as any, { isServer: true, dev: false } as any);

            expect(result.devtool).toBe('source-map');
        });

        test('does not set devtool for client builds', () => {
            const config = withFlareSourcemaps({}, { apiKey: 'test-key' });

            const webpackConfig = { plugins: [] as unknown[] };
            const result = config.webpack!(webpackConfig as any, { isServer: false, dev: false } as any);

            expect(result.devtool).toBeUndefined();
        });

        test('does not set devtool for server builds in dev mode', () => {
            const config = withFlareSourcemaps({}, { apiKey: 'test-key' });

            const webpackConfig = { plugins: [] as unknown[] };
            const result = config.webpack!(webpackConfig as any, { isServer: true, dev: true } as any);

            expect(result.devtool).toBeUndefined();
        });

        test('does not override an existing devtool on the server build', () => {
            const config = withFlareSourcemaps({}, { apiKey: 'test-key' });

            const webpackConfig = { plugins: [] as unknown[], devtool: 'eval' };
            const result = config.webpack!(webpackConfig as any, { isServer: true, dev: false } as any);

            expect(result.devtool).toBe('eval');
        });

        test('chains with existing webpack function', () => {
            const existingWebpack = vi.fn((config: any) => {
                config.resolve = { alias: { '@': '/src' } };
                return config;
            });

            const config = withFlareSourcemaps({ webpack: existingWebpack }, { apiKey: 'test-key' });

            const webpackConfig = { plugins: [] as unknown[] };
            const result = config.webpack!(webpackConfig as any, { isServer: false } as any);

            expect(existingWebpack).toHaveBeenCalled();
            expect(result.resolve).toEqual({ alias: { '@': '/src' } });
            expect(result.plugins).toHaveLength(1);
        });

        test('passes removeSourcemaps: true by default', () => {
            const config = withFlareSourcemaps({}, { apiKey: 'test-key' });

            const webpackConfig = { plugins: [] as unknown[] };
            config.webpack!(webpackConfig as any, { isServer: false } as any);

            expect(FlareWebpackPlugin).toHaveBeenCalledWith(expect.objectContaining({ removeSourcemaps: true }));
        });

        test('respects explicit removeSourcemaps: false', () => {
            const config = withFlareSourcemaps({}, { apiKey: 'test-key', removeSourcemaps: false });

            const webpackConfig = { plugins: [] as unknown[] };
            config.webpack!(webpackConfig as any, { isServer: false } as any);

            expect(FlareWebpackPlugin).toHaveBeenCalledWith(expect.objectContaining({ removeSourcemaps: false }));
        });

        test('forwards apiEndpoint and version options', () => {
            const config = withFlareSourcemaps(
                {},
                {
                    apiKey: 'test-key',
                    apiEndpoint: 'https://custom.flare.test/api',
                    version: 'v42',
                },
            );

            const webpackConfig = { plugins: [] as unknown[] };
            config.webpack!(webpackConfig as any, { isServer: false } as any);

            expect(FlareWebpackPlugin).toHaveBeenCalledWith(
                expect.objectContaining({
                    apiEndpoint: 'https://custom.flare.test/api',
                    version: 'v42',
                }),
            );
        });
    });
});
