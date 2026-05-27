import { readFileSync, unlinkSync } from 'node:fs';

import { FlareApi } from '@flareapp/flare-api';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { FlareWebpackPlugin } from '../src/FlareWebpackPlugin';

vi.mock('@flareapp/flare-api');

vi.mock('webpack', () => {
    class DefinePlugin {
        constructor(readonly _definitions: Record<string, string>) {}
        apply(_compiler: unknown) {}
    }
    class WebpackError extends Error {
        constructor(message: string) {
            super(message);
            this.name = 'WebpackError';
        }
    }
    return {
        default: { DefinePlugin, WebpackError },
        DefinePlugin,
        WebpackError,
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
    publicPath,
    target,
    name,
}: {
    mode?: string;
    watch?: boolean;
    outputPath?: string;
    publicPath?: string;
    target?: string | string[] | false;
    name?: string;
} = {}) {
    const tapPromise = vi.fn();

    const compiler = {
        name,
        options: { mode, watch, plugins: [], output: { publicPath }, target },
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
}: {
    chunks?: Array<{ files: string[]; auxiliaryFiles?: string[] }>;
    outputPath?: string;
} = {}) {
    const chunkSet = new Set(
        chunks.map((c) => ({
            files: new Set(c.files),
            auxiliaryFiles: new Set(c.auxiliaryFiles ?? []),
        })),
    );

    return {
        chunks: chunkSet,
        compiler: { outputPath },
        getPath: (_: string) => outputPath,
        warnings: [] as Error[],
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

            expect(compilation.warnings).not.toContainEqual(
                expect.objectContaining({ message: expect.stringContaining('development') }),
            );
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

        test('warns when no sourcemaps found', async () => {
            const plugin = new FlareWebpackPlugin({ apiKey: 'test-key' });
            const { compiler, tapPromise } = createMockCompiler();

            plugin.apply(compiler as any);

            const afterEmitCallback = tapPromise.mock.calls[0][1];
            const compilation = createMockCompilation({
                chunks: [{ files: ['main.js'] }],
            });
            await afterEmitCallback(compilation);

            expect(compilation.warnings).toContainEqual(
                expect.objectContaining({ message: expect.stringContaining('No sourcemap') }),
            );
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

        test('does not remove sourcemaps for failed uploads', async () => {
            vi.mocked(readFileSync).mockReturnValue('{"mappings":""}');
            vi.mocked(unlinkSync).mockImplementation(() => {});
            vi.mocked(FlareApi.prototype.uploadSourcemap)
                .mockRejectedValueOnce(new Error('upload failed'))
                .mockResolvedValueOnce();

            const plugin = new FlareWebpackPlugin({ apiKey: 'test-key', removeSourcemaps: true });
            const { compiler, tapPromise } = createMockCompiler();

            plugin.apply(compiler as any);

            const afterEmitCallback = tapPromise.mock.calls[0][1];
            const compilation = createMockCompilation({
                chunks: [
                    { files: ['fail.js'], auxiliaryFiles: ['fail.js.map'] },
                    { files: ['ok.js'], auxiliaryFiles: ['ok.js.map'] },
                ],
            });
            await afterEmitCallback(compilation);

            expect(unlinkSync).toHaveBeenCalledTimes(1);
            expect(unlinkSync).toHaveBeenCalledWith(expect.stringContaining('ok.js.map'));
        });
    });

    describe('publicPath', () => {
        test('defaults to / when no publicPath configured', async () => {
            vi.mocked(readFileSync).mockReturnValue('{"mappings":""}');
            vi.mocked(FlareApi.prototype.uploadSourcemap).mockResolvedValue();

            const plugin = new FlareWebpackPlugin({ apiKey: 'test-key' });
            const { compiler, tapPromise } = createMockCompiler();

            plugin.apply(compiler as any);

            const afterEmitCallback = tapPromise.mock.calls[0][1];
            const compilation = createMockCompilation({
                chunks: [{ files: ['main.js'], auxiliaryFiles: ['main.js.map'] }],
            });
            await afterEmitCallback(compilation);

            expect(FlareApi.prototype.uploadSourcemap).toHaveBeenCalledWith(
                expect.objectContaining({ originalFile: '/main.js' }),
            );
        });

        test('reads publicPath from compiler.options.output', async () => {
            vi.mocked(readFileSync).mockReturnValue('{"mappings":""}');
            vi.mocked(FlareApi.prototype.uploadSourcemap).mockResolvedValue();

            const plugin = new FlareWebpackPlugin({ apiKey: 'test-key' });
            const { compiler, tapPromise } = createMockCompiler({ publicPath: '/_next/' });

            plugin.apply(compiler as any);

            const afterEmitCallback = tapPromise.mock.calls[0][1];
            const compilation = createMockCompilation({
                chunks: [{ files: ['static/chunks/main.js'], auxiliaryFiles: ['static/chunks/main.js.map'] }],
            });
            await afterEmitCallback(compilation);

            expect(FlareApi.prototype.uploadSourcemap).toHaveBeenCalledWith(
                expect.objectContaining({ originalFile: '/_next/static/chunks/main.js' }),
            );
        });

        test('option overrides compiler publicPath', async () => {
            vi.mocked(readFileSync).mockReturnValue('{"mappings":""}');
            vi.mocked(FlareApi.prototype.uploadSourcemap).mockResolvedValue();

            const plugin = new FlareWebpackPlugin({ apiKey: 'test-key', publicPath: '/custom/' });
            const { compiler, tapPromise } = createMockCompiler({ publicPath: '/_next/' });

            plugin.apply(compiler as any);

            const afterEmitCallback = tapPromise.mock.calls[0][1];
            const compilation = createMockCompilation({
                chunks: [{ files: ['main.js'], auxiliaryFiles: ['main.js.map'] }],
            });
            await afterEmitCallback(compilation);

            expect(FlareApi.prototype.uploadSourcemap).toHaveBeenCalledWith(
                expect.objectContaining({ originalFile: '/custom/main.js' }),
            );
        });

        test('treats "auto" as default /', async () => {
            vi.mocked(readFileSync).mockReturnValue('{"mappings":""}');
            vi.mocked(FlareApi.prototype.uploadSourcemap).mockResolvedValue();

            const plugin = new FlareWebpackPlugin({ apiKey: 'test-key' });
            const { compiler, tapPromise } = createMockCompiler({ publicPath: 'auto' });

            plugin.apply(compiler as any);

            const afterEmitCallback = tapPromise.mock.calls[0][1];
            const compilation = createMockCompilation({
                chunks: [{ files: ['main.js'], auxiliaryFiles: ['main.js.map'] }],
            });
            await afterEmitCallback(compilation);

            expect(FlareApi.prototype.uploadSourcemap).toHaveBeenCalledWith(
                expect.objectContaining({ originalFile: '/main.js' }),
            );
        });
    });

    describe('server builds', () => {
        test('omits the publicPath prefix for node target builds', async () => {
            vi.mocked(readFileSync).mockReturnValue('{"mappings":""}');
            vi.mocked(FlareApi.prototype.uploadSourcemap).mockResolvedValue();

            const plugin = new FlareWebpackPlugin({ apiKey: 'test-key' });
            const { compiler, tapPromise } = createMockCompiler({ target: 'node', publicPath: '/_next/' });

            plugin.apply(compiler as any);

            const afterEmitCallback = tapPromise.mock.calls[0][1];
            const compilation = createMockCompilation({
                chunks: [{ files: ['chunks/0.js'], auxiliaryFiles: ['chunks/0.js.map'] }],
            });
            await afterEmitCallback(compilation);

            expect(FlareApi.prototype.uploadSourcemap).toHaveBeenCalledWith(
                expect.objectContaining({ originalFile: 'chunks/0.js' }),
            );
        });

        test('detects versioned node targets like "node10"', async () => {
            vi.mocked(readFileSync).mockReturnValue('{"mappings":""}');
            vi.mocked(FlareApi.prototype.uploadSourcemap).mockResolvedValue();

            const plugin = new FlareWebpackPlugin({ apiKey: 'test-key' });
            const { compiler, tapPromise } = createMockCompiler({ target: ['node10'], publicPath: '/_next/' });

            plugin.apply(compiler as any);

            const afterEmitCallback = tapPromise.mock.calls[0][1];
            const compilation = createMockCompilation({
                chunks: [{ files: ['chunks/0.js'], auxiliaryFiles: ['chunks/0.js.map'] }],
            });
            await afterEmitCallback(compilation);

            expect(FlareApi.prototype.uploadSourcemap).toHaveBeenCalledWith(
                expect.objectContaining({ originalFile: 'chunks/0.js' }),
            );
        });

        test('detects Next.js server compiler by name', async () => {
            vi.mocked(readFileSync).mockReturnValue('{"mappings":""}');
            vi.mocked(FlareApi.prototype.uploadSourcemap).mockResolvedValue();

            const plugin = new FlareWebpackPlugin({ apiKey: 'test-key' });
            const { compiler, tapPromise } = createMockCompiler({ name: 'server', publicPath: '/_next/' });

            plugin.apply(compiler as any);

            const afterEmitCallback = tapPromise.mock.calls[0][1];
            const compilation = createMockCompilation({
                chunks: [{ files: ['chunks/0.js'], auxiliaryFiles: ['chunks/0.js.map'] }],
            });
            await afterEmitCallback(compilation);

            expect(FlareApi.prototype.uploadSourcemap).toHaveBeenCalledWith(
                expect.objectContaining({ originalFile: 'chunks/0.js' }),
            );
        });

        test('keeps the publicPath prefix for browser target builds', async () => {
            vi.mocked(readFileSync).mockReturnValue('{"mappings":""}');
            vi.mocked(FlareApi.prototype.uploadSourcemap).mockResolvedValue();

            const plugin = new FlareWebpackPlugin({ apiKey: 'test-key' });
            const { compiler, tapPromise } = createMockCompiler({ target: 'web', publicPath: '/_next/' });

            plugin.apply(compiler as any);

            const afterEmitCallback = tapPromise.mock.calls[0][1];
            const compilation = createMockCompilation({
                chunks: [{ files: ['chunks/0.js'], auxiliaryFiles: ['chunks/0.js.map'] }],
            });
            await afterEmitCallback(compilation);

            expect(FlareApi.prototype.uploadSourcemap).toHaveBeenCalledWith(
                expect.objectContaining({ originalFile: '/_next/chunks/0.js' }),
            );
        });
    });
});
