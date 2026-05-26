import { readFileSync, unlinkSync } from 'node:fs';

import { FlareApi } from '@flareapp/flare-api';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { FlareWebpackPlugin } from '../src/FlareWebpackPlugin';

vi.mock('@flareapp/flare-api');

vi.mock('webpack', () => {
    class DefinePlugin {
        constructor(_definitions: Record<string, string>) {}
        apply(_compiler: unknown) {}
    }
    return {
        default: { DefinePlugin },
        DefinePlugin,
    };
});

vi.mock('node:fs', () => ({
    readFileSync: vi.fn(),
    unlinkSync: vi.fn(),
}));

afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
});

function createMockCompiler({
    mode = 'production',
    watch = false,
    outputPath = '/dist',
}: { mode?: string; watch?: boolean; outputPath?: string } = {}) {
    const tapPromise = vi.fn();

    const compiler = {
        options: { mode, watch, plugins: [] },
        hooks: {
            afterEmit: { tapPromise },
        },
        outputPath,
    };

    return { compiler, tapPromise };
}

function createMockCompilation({
    chunks = [],
    outputPath = '/dist',
}: { chunks?: Array<{ files: string[]; auxiliaryFiles?: string[] }>; outputPath?: string } = {}) {
    return {
        getStats: () => ({
            toJson: () => ({ chunks }),
        }),
        compiler: { outputPath },
        getPath: (_: string) => outputPath,
        warnings: [] as string[],
    };
}

describe('FlareWebpackPlugin', () => {
    describe('constructor', () => {
        test('accepts required apiKey option', () => {
            const plugin = new FlareWebpackPlugin({ apiKey: 'test-key' });
            expect(plugin).toBeInstanceOf(FlareWebpackPlugin);
        });
    });

    describe('apply', () => {
        test('registers afterEmit hook', () => {
            const plugin = new FlareWebpackPlugin({ apiKey: 'test-key' });
            const { compiler, tapPromise } = createMockCompiler();

            plugin.apply(compiler as any);

            expect(tapPromise).toHaveBeenCalledWith('FlareWebpackPlugin', expect.any(Function));
        });
    });

    describe('option verification', () => {
        test('skips upload when no apiKey provided', async () => {
            const plugin = new FlareWebpackPlugin({ apiKey: '' });
            const { compiler, tapPromise } = createMockCompiler();

            plugin.apply(compiler as any);

            const afterEmitCallback = tapPromise.mock.calls[0][1];
            const compilation = createMockCompilation();
            await afterEmitCallback(compilation);

            expect(FlareApi.prototype.uploadSourcemap).not.toHaveBeenCalled();
            expect(compilation.warnings.length).toBeGreaterThan(0);
        });

        test('skips upload in development mode by default', async () => {
            const plugin = new FlareWebpackPlugin({ apiKey: 'test-key' });
            const { compiler, tapPromise } = createMockCompiler({ mode: 'development' });

            plugin.apply(compiler as any);

            const afterEmitCallback = tapPromise.mock.calls[0][1];
            const compilation = createMockCompilation();
            await afterEmitCallback(compilation);

            expect(FlareApi.prototype.uploadSourcemap).not.toHaveBeenCalled();
        });

        test('uploads in development when runInDevelopment is true', async () => {
            const plugin = new FlareWebpackPlugin({ apiKey: 'test-key', runInDevelopment: true });
            const { compiler, tapPromise } = createMockCompiler({ mode: 'development' });

            plugin.apply(compiler as any);

            const afterEmitCallback = tapPromise.mock.calls[0][1];
            const compilation = createMockCompilation();
            await afterEmitCallback(compilation);

            expect(compilation.warnings).not.toContainEqual(expect.stringContaining('development'));
        });

        test('skips upload in watch mode', async () => {
            const plugin = new FlareWebpackPlugin({ apiKey: 'test-key' });
            const { compiler, tapPromise } = createMockCompiler({ watch: true });

            plugin.apply(compiler as any);

            const afterEmitCallback = tapPromise.mock.calls[0][1];
            const compilation = createMockCompilation();
            await afterEmitCallback(compilation);

            expect(FlareApi.prototype.uploadSourcemap).not.toHaveBeenCalled();
        });
    });

    describe('sourcemap discovery', () => {
        test('finds .js.map files from chunk auxiliaryFiles', async () => {
            vi.mocked(readFileSync).mockReturnValue('{"mappings":""}');
            vi.mocked(FlareApi.prototype.uploadSourcemap).mockResolvedValue();

            const plugin = new FlareWebpackPlugin({ apiKey: 'test-key' });
            const { compiler, tapPromise } = createMockCompiler();

            plugin.apply(compiler as any);

            const afterEmitCallback = tapPromise.mock.calls[0][1];
            const compilation = createMockCompilation({
                chunks: [
                    { files: ['main.js'], auxiliaryFiles: ['main.js.map'] },
                    { files: ['vendor.js'], auxiliaryFiles: ['vendor.js.map'] },
                ],
            });
            await afterEmitCallback(compilation);

            expect(FlareApi.prototype.uploadSourcemap).toHaveBeenCalledTimes(2);
        });

        test('falls back to files array when auxiliaryFiles missing (webpack 4)', async () => {
            vi.mocked(readFileSync).mockReturnValue('{"mappings":""}');
            vi.mocked(FlareApi.prototype.uploadSourcemap).mockResolvedValue();

            const plugin = new FlareWebpackPlugin({ apiKey: 'test-key' });
            const { compiler, tapPromise } = createMockCompiler();

            plugin.apply(compiler as any);

            const afterEmitCallback = tapPromise.mock.calls[0][1];
            const compilation = createMockCompilation({
                chunks: [{ files: ['main.js', 'main.js.map'] }],
            });
            await afterEmitCallback(compilation);

            expect(FlareApi.prototype.uploadSourcemap).toHaveBeenCalledTimes(1);
        });

        test('warns when no sourcemaps found', async () => {
            const plugin = new FlareWebpackPlugin({ apiKey: 'test-key' });
            const { compiler, tapPromise } = createMockCompiler();

            plugin.apply(compiler as any);

            const afterEmitCallback = tapPromise.mock.calls[0][1];
            const compilation = createMockCompilation({
                chunks: [{ files: ['main.js'] }],
            });
            await afterEmitCallback(compilation);

            expect(compilation.warnings).toContainEqual(expect.stringContaining('No sourcemap'));
        });
    });

    describe('sourcemap removal', () => {
        test('removes sourcemap files when removeSourcemaps is true', async () => {
            vi.mocked(readFileSync).mockReturnValue('{"mappings":""}');
            vi.mocked(unlinkSync).mockImplementation(() => {});
            vi.mocked(FlareApi.prototype.uploadSourcemap).mockResolvedValue();

            const plugin = new FlareWebpackPlugin({ apiKey: 'test-key', removeSourcemaps: true });
            const { compiler, tapPromise } = createMockCompiler();

            plugin.apply(compiler as any);

            const afterEmitCallback = tapPromise.mock.calls[0][1];
            const compilation = createMockCompilation({
                chunks: [{ files: ['main.js'], auxiliaryFiles: ['main.js.map'] }],
            });
            await afterEmitCallback(compilation);

            expect(unlinkSync).toHaveBeenCalledWith(expect.stringContaining('main.js.map'));
        });
    });
});
