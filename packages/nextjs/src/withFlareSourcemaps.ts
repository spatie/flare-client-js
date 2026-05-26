import { FlareWebpackPlugin } from '@flareapp/webpack';

import type { FlareNextjsPluginOptions } from './types';

type NextConfig = Record<string, any>;

export function withFlareSourcemaps(nextConfig: NextConfig, options: FlareNextjsPluginOptions): NextConfig {
    const removeSourcemaps = options.removeSourcemaps ?? true;

    return {
        ...nextConfig,
        productionBrowserSourceMaps: nextConfig.productionBrowserSourceMaps ?? true,
        webpack(config: any, context: any) {
            if (typeof nextConfig.webpack === 'function') {
                config = nextConfig.webpack(config, context);
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
