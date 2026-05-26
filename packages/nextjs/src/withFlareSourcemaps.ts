import { FlareWebpackPlugin } from '@flareapp/webpack';

import type { FlareNextjsPluginOptions } from './types';

// eslint-disable-next-line typescript/no-explicit-any -- Next.js config is intentionally untyped to avoid depending on `next` types
type NextConfig = Record<string, unknown>;

type WebpackConfig = { plugins: unknown[] } & Record<string, unknown>;
type WebpackContext = { isServer: boolean } & Record<string, unknown>;

export function withFlareSourcemaps(nextConfig: NextConfig, options: FlareNextjsPluginOptions): NextConfig {
    const removeSourcemaps = options.removeSourcemaps ?? true;

    return {
        ...nextConfig,
        productionBrowserSourceMaps: (nextConfig.productionBrowserSourceMaps as boolean | undefined) ?? true,
        webpack(config: WebpackConfig, context: WebpackContext) {
            if (typeof nextConfig.webpack === 'function') {
                config = (nextConfig.webpack as (c: WebpackConfig, ctx: WebpackContext) => WebpackConfig)(
                    config,
                    context
                );
            }

            if (!context.isServer) {
                config.plugins.push(
                    new FlareWebpackPlugin({
                        apiKey: options.apiKey,
                        apiEndpoint: options.apiEndpoint,
                        version: options.version,
                        runInDevelopment: options.runInDevelopment,
                        removeSourcemaps,
                    })
                );
            }

            return config;
        },
    };
}
