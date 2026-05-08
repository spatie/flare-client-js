import { existsSync, readFileSync, unlinkSync } from 'node:fs';

import { afterEach, describe, expect, test, vi } from 'vitest';

import { FlareApi } from '../src/flareApi';
import flareSourcemaps from '../src/index';

vi.mock('node:fs', () => ({
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    unlinkSync: vi.fn(),
}));

vi.mock('../src/flareApi');

function createPlugin(
    { apiKey = 'test-key', ...rest }: Parameters<typeof flareSourcemaps>[0] = { apiKey: 'test-key' }
) {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const plugin = flareSourcemaps({ apiKey, ...rest }) as any;
    warnSpy.mockRestore();

    plugin.config({}, { mode: 'production' });
    plugin.configResolved({ logger: { info: vi.fn(), error: vi.fn() }, base: '/' });

    return plugin;
}

afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
});

describe('flareSourcemaps plugin', () => {
    describe('config hook', () => {
        test('uses JSON.stringify for define values (prevents injection)', () => {
            const plugin = flareSourcemaps({
                apiKey: "key-with-'quote",
                version: "ver-with-'quote",
            }) as any;

            const result = plugin.config({ build: {} }, { mode: 'production' });

            expect(result.define.FLARE_JS_KEY).toBe(JSON.stringify("key-with-'quote"));
            expect(result.define.FLARE_SOURCEMAP_VERSION).toBe(JSON.stringify("ver-with-'quote"));
        });

        test('sets sourcemap to hidden when upload is enabled', () => {
            const plugin = flareSourcemaps({ apiKey: 'test-key' }) as any;

            const result = plugin.config({ build: {} }, { mode: 'production' });

            expect(result.build.sourcemap).toBe('hidden');
        });

        test('disables upload in development mode unless runInDevelopment is true', () => {
            const plugin = flareSourcemaps({ apiKey: 'test-key' }) as any;

            const result = plugin.config({ build: {} }, { mode: 'development' });
            expect(result.build.sourcemap).toBeUndefined();
        });

        test('enables upload in development when runInDevelopment is true', () => {
            const plugin = flareSourcemaps({ apiKey: 'test-key', runInDevelopment: true }) as any;

            const result = plugin.config({ build: {} }, { mode: 'development' });
            expect(result.build.sourcemap).toBe('hidden');
        });
    });

    describe('plugin metadata', () => {
        test('has correct name', () => {
            const plugin = flareSourcemaps({ apiKey: 'test' }) as any;
            expect(plugin.name).toBe('flare-vite-plugin');
        });

        test('applies only to build', () => {
            const plugin = flareSourcemaps({ apiKey: 'test' }) as any;
            expect(plugin.apply).toBe('build');
        });

        test('enforces post order', () => {
            const plugin = flareSourcemaps({ apiKey: 'test' }) as any;
            expect(plugin.enforce).toBe('post');
        });
    });

    describe('missing API key', () => {
        test('warns when no API key provided', () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            flareSourcemaps({ apiKey: '' });

            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('No Flare API key'));
            warnSpy.mockRestore();
        });
    });

    describe('writeBundle — sourcemap discovery from bundle parameter', () => {
        test('discovers .map files from bundle keys, not from the filesystem', async () => {
            const plugin = createPlugin();
            const uploadSpy = vi.mocked(FlareApi.prototype.uploadSourcemap).mockResolvedValue();
            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(readFileSync).mockReturnValue('{"mappings":"AAAA"}');

            await plugin.writeBundle(
                { dir: '/dist' },
                {
                    'assets/app.js': {},
                    'assets/app.js.map': {},
                    'assets/vendor.js': {},
                    'assets/vendor.js.map': {},
                }
            );

            expect(uploadSpy).toHaveBeenCalledTimes(2);
            expect(uploadSpy).toHaveBeenCalledWith(expect.objectContaining({ originalFile: '/assets/app.js' }));
            expect(uploadSpy).toHaveBeenCalledWith(expect.objectContaining({ originalFile: '/assets/vendor.js' }));
        });

        test('ignores non-.map entries in the bundle', async () => {
            const plugin = createPlugin();
            const uploadSpy = vi.mocked(FlareApi.prototype.uploadSourcemap).mockResolvedValue();
            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(readFileSync).mockReturnValue('{"mappings":"AAAA"}');

            await plugin.writeBundle(
                { dir: '/dist' },
                {
                    'assets/app.js': {},
                    'assets/app.css': {},
                    'assets/index.html': {},
                }
            );

            expect(uploadSpy).not.toHaveBeenCalled();
        });

        test('skips .map files when corresponding source file does not exist on disk', async () => {
            const plugin = createPlugin();
            const uploadSpy = vi.mocked(FlareApi.prototype.uploadSourcemap).mockResolvedValue();
            vi.mocked(existsSync).mockReturnValue(false);

            await plugin.writeBundle({ dir: '/dist' }, { 'assets/app.js.map': {} });

            expect(uploadSpy).not.toHaveBeenCalled();
            expect(existsSync).toHaveBeenCalledWith(expect.stringContaining('assets/app.js'));
        });

        test('reads sourcemap content from disk for each bundle .map entry', async () => {
            const plugin = createPlugin();
            vi.mocked(FlareApi.prototype.uploadSourcemap).mockResolvedValue();
            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(readFileSync).mockReturnValue('{"version":3,"mappings":"AAAA"}');

            await plugin.writeBundle({ dir: '/dist' }, { 'assets/app.js.map': {} });

            expect(readFileSync).toHaveBeenCalledWith(expect.stringContaining('assets/app.js.map'), 'utf8');
        });

        test('prefixes originalFile with resolved base path', async () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const plugin = flareSourcemaps({ apiKey: 'test-key', base: '/my-app/' }) as any;
            warnSpy.mockRestore();

            plugin.config({}, { mode: 'production' });
            plugin.configResolved({ logger: { info: vi.fn(), error: vi.fn() }, base: '/' });

            const uploadSpy = vi.mocked(FlareApi.prototype.uploadSourcemap).mockResolvedValue();
            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(readFileSync).mockReturnValue('{"mappings":""}');

            await plugin.writeBundle({ dir: '/dist' }, { 'assets/app.js.map': {} });

            expect(uploadSpy).toHaveBeenCalledWith(expect.objectContaining({ originalFile: '/my-app/assets/app.js' }));
        });

        test('does not upload when upload is disabled', async () => {
            const plugin = createPlugin({ apiKey: '' });
            const uploadSpy = vi.mocked(FlareApi.prototype.uploadSourcemap).mockResolvedValue();

            await plugin.writeBundle({ dir: '/dist' }, { 'assets/app.js.map': {} });

            expect(uploadSpy).not.toHaveBeenCalled();
        });

        test('continues uploading remaining sourcemaps when one fails', async () => {
            const plugin = createPlugin();
            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(readFileSync).mockReturnValue('{"mappings":""}');

            const uploadSpy = vi.mocked(FlareApi.prototype.uploadSourcemap);
            uploadSpy.mockRejectedValueOnce(new Error('upload failed')).mockResolvedValueOnce();

            await plugin.writeBundle(
                { dir: '/dist' },
                {
                    'assets/app.js.map': {},
                    'assets/vendor.js.map': {},
                }
            );

            expect(uploadSpy).toHaveBeenCalledTimes(2);
        });

        test('only deletes sourcemaps that uploaded successfully', async () => {
            const plugin = createPlugin({ apiKey: 'test-key', removeSourcemaps: true });
            vi.mocked(existsSync).mockReturnValue(true);
            vi.mocked(readFileSync).mockReturnValue('{"mappings":""}');

            const uploadSpy = vi.mocked(FlareApi.prototype.uploadSourcemap);
            uploadSpy.mockRejectedValueOnce(new Error('upload failed')).mockResolvedValueOnce();

            await plugin.writeBundle(
                { dir: '/dist' },
                {
                    'assets/fail.js.map': {},
                    'assets/ok.js.map': {},
                }
            );

            expect(unlinkSync).toHaveBeenCalledTimes(1);
            expect(unlinkSync).toHaveBeenCalledWith(expect.stringContaining('ok.js.map'));
        });
    });
});
