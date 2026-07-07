import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

import { FlareApi } from '@flareapp/flare-api';
import { type Plugin, type ResolvedConfig } from 'vite';

import type { FlareVitePluginOptions, Sourcemap } from './types';

export type { FlareVitePluginOptions, Sourcemap } from './types';

export default function flareSourcemaps({
    apiKey,
    base,
    apiEndpoint = 'https://flareapp.io/api/sourcemaps',
    runInDevelopment = false,
    version = randomUUID(),
    removeSourcemaps = false,
}: FlareVitePluginOptions): Plugin {
    let logger: ResolvedConfig['logger'] | null = null;
    let resolvedBase = base ?? '/';
    let enableUpload = false;
    let isSsrBuild = false;

    const flare = new FlareApi(apiEndpoint, apiKey, version);

    function log(message: string, isError = false) {
        const formatted = `@flareapp/vite: ${message}`;
        if (isError) {
            if (logger) logger.error(formatted);
            else console.error(formatted);
        } else {
            if (logger) logger.info(formatted);
            else console.log(formatted);
        }
    }

    if (!apiKey) {
        console.warn('@flareapp/vite: No Flare API key provided, sourcemap upload disabled.');
    }

    return {
        name: 'flare-vite-plugin',
        apply: 'build',
        enforce: 'post',

        config(_userConfig, { mode }) {
            enableUpload =
                !!apiKey && (mode !== 'development' || runInDevelopment) && process.env.SKIP_SOURCEMAPS !== 'true';

            return {
                define: {
                    FLARE_SOURCEMAP_VERSION: JSON.stringify(version),
                    FLARE_JS_KEY: JSON.stringify(apiKey),
                },
                build: {
                    sourcemap: enableUpload ? 'hidden' : undefined,
                },
            };
        },

        configResolved(config) {
            logger = config.logger;

            isSsrBuild = !!config.build?.ssr;

            if (!base) {
                resolvedBase = config.base;
            }
            if (!resolvedBase.endsWith('/')) {
                resolvedBase += '/';
            }
        },

        async writeBundle(outputOptions, bundle) {
            if (!enableUpload) {
                return;
            }

            const outputDir = outputOptions.dir || '';

            const sourcemaps: Sourcemap[] = [];

            for (const fileName of Object.keys(bundle)) {
                if (!fileName.endsWith('.map')) {
                    continue;
                }

                const sourceFileName = fileName.replace(/\.map$/, '');
                const sourceFilePath = resolve(outputDir, sourceFileName);

                if (!existsSync(sourceFilePath)) {
                    log(`No corresponding source found for "${fileName}"`, true);
                    continue;
                }

                const sourcemapPath = resolve(outputDir, fileName);

                try {
                    // SSR runtime frames are file:// paths, not web URLs, so the base prefix is
                    // meaningless. Use the bundle-relative path for backend suffix-matching.
                    const originalFile = isSsrBuild ? sourceFileName : `${resolvedBase}${sourceFileName}`;

                    sourcemaps.push({
                        content: readFileSync(sourcemapPath, 'utf8'),
                        sourcemapPath,
                        originalFile,
                    });
                } catch (error) {
                    log(`Error reading sourcemap ${sourcemapPath}: ${error}`, true);
                }
            }

            if (!sourcemaps.length) {
                return;
            }

            log(`Uploading ${sourcemaps.length} sourcemap(s) to Flare.`);

            const results = await Promise.allSettled(sourcemaps.map((sourcemap) => flare.uploadSourcemap(sourcemap)));

            const failed = results.filter((r) => r.status === 'rejected');
            if (failed.length > 0) {
                for (const result of failed) {
                    log(`Upload failed: ${(result as PromiseRejectedResult).reason}`, true);
                }
                log(`${failed.length}/${sourcemaps.length} sourcemap upload(s) failed.`, true);
            } else {
                log('Successfully uploaded all sourcemaps to Flare.');
            }

            if (removeSourcemaps) {
                for (let i = 0; i < sourcemaps.length; i++) {
                    if (results[i].status === 'rejected') {
                        continue;
                    }
                    try {
                        unlinkSync(sourcemaps[i].sourcemapPath);
                    } catch (error) {
                        log(`Error removing ${sourcemaps[i].sourcemapPath}: ${error}`, true);
                    }
                }
                log('Removed sourcemap files from build output.');
            }
        },
    };
}
