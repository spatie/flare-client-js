import glob from 'fast-glob';
import { existsSync, readFileSync, unlinkSync } from 'fs';
import { resolve } from 'path';
import { OutputOptions } from 'rollup';
import { Plugin, ResolvedConfig, UserConfig } from 'vite';

import FlareApi from './flareApi';
import { uuid } from './util';

export type PluginConfig = {
    key: string;
    base?: string;
    apiEndpoint?: string;
    runInDevelopment?: boolean;
    version?: string;
    removeSourcemaps?: boolean;
};

export type Sourcemap = {
    original_file: string;
    content: string;
    sourcemap_url: string;
};

export default function flareSourcemapUploader({
    key,
    base,
    apiEndpoint = 'https://flareapp.io/api/sourcemaps',
    runInDevelopment = false,
    version = uuid(),
    removeSourcemaps = false,
}: PluginConfig): Plugin {
    if (!key) {
        flareLog('No Flare API key was provided, not uploading sourcemaps to Flare.');
    }

    const flare = new FlareApi(apiEndpoint, key, version);

    const enableUploadingSourcemaps =
        key && (process.env.NODE_ENV !== 'development' || runInDevelopment) && process.env.SKIP_SOURCEMAPS !== 'true';

    return {
        name: 'flare-vite-plugin',
        apply: 'build',

        config({ build }: UserConfig, { mode }: { mode: string }) {
            return {
                // Set FLARE_SOURCEMAP_VERSION and API key so the Flare JS client can read it
                define: {
                    FLARE_SOURCEMAP_VERSION: `'${version}'`,
                    FLARE_JS_KEY: `'${key}'`,
                },
                build: {
                    sourcemap: (() => {
                        if (build?.sourcemap !== undefined) return build.sourcemap;
                        const enableSourcemaps = enableUploadingSourcemaps && mode !== 'development';
                        if (enableSourcemaps) return 'hidden';
                        return false;
                    })(),
                },
            };
        },

        configResolved(config: ResolvedConfig) {
            base = base || config.base;
            base += base.endsWith('/') ? '' : '/';
        },

        async writeBundle(outputConfig: OutputOptions) {
            if (!enableUploadingSourcemaps) {
                return;
            }

            const outputDir = outputConfig.dir || '';

            const files = await glob('./**/*.map', { cwd: outputDir });
            const sourcemaps = files
                .map((file): Sourcemap | null => {
                    const sourcePath = file.replace(/\.map$/, '');
                    const sourceFilename = resolve(outputDir, sourcePath);

                    if (!existsSync(sourceFilename)) {
                        flareLog(`no corresponding source found for "${file}"`, true);
                        return null;
                    }

                    const sourcemapLocation = resolve(outputDir, file);

                    try {
                        return {
                            content: readFileSync(sourcemapLocation, 'utf8'),
                            sourcemap_url: sourcemapLocation,
                            original_file: `${base}${sourcePath}`,
                        };
                    } catch (error) {
                        flareLog('Error reading sourcemap file ' + sourcemapLocation + ': ' + error, true);
                        return null;
                    }
                })
                .filter((sourcemap) => sourcemap !== null) as Sourcemap[];

            if (!sourcemaps.length) {
                return;
            }

            flareLog(`Uploading ${sourcemaps.length} sourcemap files to Flare.`);

            const pendingUploads = sourcemaps.map((sourcemap) => () => flare.uploadSourcemap(sourcemap));

            try {
                while (pendingUploads.length) {
                    // Maximum 10 at once https://stackoverflow.com/a/58686835
                    await Promise.all(pendingUploads.splice(0, 10).map((f) => f()));
                }

                flareLog('Successfully uploaded sourcemaps to Flare.');
            } catch (error) {
                flareLog(`Something went wrong while uploading the sourcemaps to Flare: ${error}`, true);
            }

            if (removeSourcemaps) {
                sourcemaps.forEach(({ sourcemap_url }) => {
                    try {
                        unlinkSync(sourcemap_url);
                    } catch (error) {
                        console.error('Error removing sourcemap file', sourcemap_url, ': ', error);
                    }
                });

                flareLog('Successfully removed sourcemaps.');
            }
        },
    };
}

function flareLog(message: string, isError = false) {
    const formattedMessage = '@flareapp/vite: ' + message;

    if (isError) {
        console.error(formattedMessage);
        return;
    }

    console.log(formattedMessage);
}
