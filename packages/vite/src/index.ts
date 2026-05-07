import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { type Plugin, type ResolvedConfig } from 'vite';

import { FlareApi } from './flareApi';
import { FlareVitePluginOptions, Sourcemap } from './types';

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

    const flare = new FlareApi(apiEndpoint, apiKey, version);

    function log(message: string, isError = false) {
        const formatted = `@flareapp/vite: ${message}`;
        if (isError) {
            logger ? logger.error(formatted) : console.error(formatted);
        } else {
            logger ? logger.info(formatted) : console.log(formatted);
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

            for (const [fileName, chunk] of Object.entries(bundle)) {
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
                    sourcemaps.push({
                        content: readFileSync(sourcemapPath, 'utf8'),
                        sourcemapPath,
                        originalFile: `${resolvedBase}${sourceFileName}`,
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
                for (const { sourcemapPath } of sourcemaps) {
                    try {
                        unlinkSync(sourcemapPath);
                    } catch (error) {
                        log(`Error removing ${sourcemapPath}: ${error}`, true);
                    }
                }
                log('Removed sourcemap files from build output.');
            }
        },
    };
}
