import { randomUUID } from 'node:crypto';

import { FlareWebpackPlugin } from '@flareapp/webpack';

import type { FlareNextjsPluginOptions } from './types';

type NextConfig = Record<string, unknown>;

type WebpackConfig = { plugins: unknown[]; devtool?: string | false } & Record<string, unknown>;
type WebpackContext = { isServer: boolean; dev?: boolean } & Record<string, unknown>;

export function withFlareSourcemaps(nextConfig: NextConfig, options: FlareNextjsPluginOptions): NextConfig {
    const removeSourcemaps = options.removeSourcemaps ?? false;
    const version = options.version ?? randomUUID();

    const existingExperimental = (nextConfig.experimental as Record<string, unknown> | undefined) ?? {};

    return {
        ...nextConfig,
        productionBrowserSourceMaps: (nextConfig.productionBrowserSourceMaps as boolean | undefined) ?? true,
        experimental: {
            ...existingExperimental,
            // Next.js does not emit server sourcemaps by default. Supported since Next 15.
            serverSourceMaps: (existingExperimental.serverSourceMaps as boolean | undefined) ?? true,
        },
        webpack(config: WebpackConfig, context: WebpackContext) {
            if (typeof nextConfig.webpack === 'function') {
                config = (nextConfig.webpack as (c: WebpackConfig, ctx: WebpackContext) => WebpackConfig)(
                    config,
                    context,
                );
            }

            // The webpack plugin auto-detects the server compiler and emits base-free paths, so
            // registering it for every build is safe.
            config.plugins.push(
                new FlareWebpackPlugin({
                    apiKey: options.apiKey,
                    apiEndpoint: options.apiEndpoint,
                    version,
                    runInDevelopment: options.runInDevelopment,
                    removeSourcemaps,
                    publicPath: options.publicPath,
                }),
            );

            // Emit .js.map for production server builds so the plugin has something to upload.
            // Never override a devtool the user already configured.
            if (context.isServer && !context.dev && config.devtool == null) {
                config.devtool = 'source-map';
            }

            return config;
        },
    };
}
