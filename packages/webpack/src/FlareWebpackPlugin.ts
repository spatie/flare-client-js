import { randomUUID } from 'node:crypto';
import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import { FlareApi, type Sourcemap } from '@flareapp/flare-api';
import webpack from 'webpack';

import type { FlareWebpackPluginOptions } from './types';

type Compiler = {
    options: { mode?: string; watch?: boolean; plugins?: unknown[] };
    hooks: {
        afterEmit: {
            tapPromise: (name: string, callback: (compilation: Compilation) => Promise<void>) => void;
        };
    };
    outputPath: string;
};

type Chunk = {
    files: string[];
    auxiliaryFiles?: string[];
};

type Compilation = {
    getStats: () => { toJson: () => { chunks?: Chunk[] } };
    compiler: { outputPath: string };
    getPath: (path: string) => string;
    warnings: string[];
};

function log(message: string, isError = false) {
    const formatted = `@flareapp/webpack: ${message}`;
    if (isError) {
        console.error(formatted);
    } else {
        console.log(formatted);
    }
}

export class FlareWebpackPlugin {
    private readonly apiKey: string;
    private readonly apiEndpoint: string;
    private readonly runInDevelopment: boolean;
    private readonly version: string;
    private readonly removeSourcemaps: boolean;

    constructor({
        apiKey,
        apiEndpoint = 'https://flareapp.io/api/sourcemaps',
        runInDevelopment = false,
        version = randomUUID(),
        removeSourcemaps = false,
    }: FlareWebpackPluginOptions) {
        this.apiKey = apiKey;
        this.apiEndpoint = apiEndpoint;
        this.runInDevelopment = runInDevelopment;
        this.version = version;
        this.removeSourcemaps = removeSourcemaps;
    }

    apply(compiler: Compiler) {
        const { DefinePlugin } = webpack;

        new DefinePlugin({
            FLARE_JS_KEY: JSON.stringify(this.apiKey),
            FLARE_SOURCEMAP_VERSION: JSON.stringify(this.version),
        }).apply(compiler as unknown as Parameters<InstanceType<typeof webpack.DefinePlugin>['apply']>[0]);

        compiler.hooks.afterEmit.tapPromise('FlareWebpackPlugin', async (compilation) => {
            if (!this.shouldUpload(compiler, compilation)) {
                return;
            }

            const flare = new FlareApi(this.apiEndpoint, this.apiKey, this.version);
            const sourcemaps = this.getSourcemaps(compilation);

            if (!sourcemaps.length) {
                compilation.warnings.push(
                    '@flareapp/webpack: No sourcemap files found. Make sure sourcemaps are enabled in your webpack config.'
                );
                return;
            }

            log(`Uploading ${sourcemaps.length} sourcemap(s) to Flare.`);

            const results = await Promise.allSettled(
                sourcemaps.map(({ sourcemap }) => flare.uploadSourcemap(sourcemap))
            );

            const failed = results.filter((r) => r.status === 'rejected');
            if (failed.length > 0) {
                for (const result of failed) {
                    compilation.warnings.push(
                        `@flareapp/webpack: Upload failed: ${(result as PromiseRejectedResult).reason}`
                    );
                }
            } else {
                log('Successfully uploaded all sourcemaps to Flare.');
            }

            if (this.removeSourcemaps) {
                for (let i = 0; i < sourcemaps.length; i++) {
                    if (results[i].status === 'rejected') {
                        continue;
                    }
                    try {
                        unlinkSync(sourcemaps[i].path);
                    } catch (error) {
                        log(`Error removing ${sourcemaps[i].path}: ${error}`, true);
                    }
                }
                log('Removed sourcemap files from build output.');
            }
        });
    }

    private shouldUpload(compiler: Compiler, compilation: Compilation): boolean {
        if (!this.apiKey) {
            compilation.warnings.push('@flareapp/webpack: No Flare API key provided, not uploading sourcemaps.');
            return false;
        }

        if (!this.runInDevelopment && compiler.options.mode === 'development') {
            log('Running webpack in development mode, not uploading sourcemaps.');
            return false;
        }

        if (compiler.options.watch) {
            log('Running webpack in watch mode, not uploading sourcemaps.');
            return false;
        }

        return true;
    }

    private getSourcemaps(compilation: Compilation): Array<{ sourcemap: Sourcemap; path: string }> {
        const chunks = compilation.getStats().toJson().chunks;
        const outputPath = compilation.getPath(compilation.compiler.outputPath);

        if (!chunks) {
            return [];
        }

        const sourcemaps: Array<{ sourcemap: Sourcemap; path: string }> = [];

        for (const chunk of chunks) {
            const jsFile = chunk.files.find((file) => file.endsWith('.js'));
            const mapFile = (chunk.auxiliaryFiles || chunk.files).find((file) => file.endsWith('.js.map'));

            if (!jsFile || !mapFile) {
                continue;
            }

            const mapPath = join(outputPath, mapFile);

            try {
                const content = readFileSync(mapPath, 'utf8');
                sourcemaps.push({
                    sourcemap: { originalFile: jsFile, content },
                    path: mapPath,
                });
            } catch (error) {
                log(`Error reading sourcemap ${mapPath}: ${error}`, true);
            }
        }

        return sourcemaps;
    }
}
