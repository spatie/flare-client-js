import { afterEach, describe, expect, test, vi } from 'vitest';

import { parseArgs, runCli } from '../src/cli';
import { readFlareConfig } from '../src/config';
import { uploadSourcemaps } from '../src/uploadSourcemaps';

vi.mock('../src/uploadSourcemaps', () => ({ uploadSourcemaps: vi.fn().mockResolvedValue(undefined) }));
// flare.json reading is covered in config.test.ts; here we stub it so the CLI's
// key/endpoint resolution falls through to flags/env deterministically.
vi.mock('../src/config', () => ({ readFlareConfig: vi.fn().mockReturnValue({}) }));

afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    process.exitCode = undefined;
    delete process.env.FLARE_API_KEY;
    delete process.env.FLARE_API_ENDPOINT;
    delete process.env.FLARE_SOURCEMAP_VERSION;
});

describe('parseArgs', () => {
    test('parses the command and its flags', () => {
        const { command, flags } = parseArgs([
            'upload',
            '--api-key',
            'k',
            '--sourcemap',
            '/a.map',
            '--bundle-filename',
            'index.android.bundle',
        ]);
        expect(command).toBe('upload');
        expect(flags).toEqual({
            'api-key': 'k',
            'sourcemap': '/a.map',
            'bundle-filename': 'index.android.bundle',
        });
    });

    test('treats a flag with no value as a boolean "true"', () => {
        const { flags } = parseArgs(['upload', '--verbose']);
        expect(flags.verbose).toBe('true');
    });

    test('parses the --flag=value form', () => {
        const { flags } = parseArgs(['upload', '--api-key=k', '--sourcemap=/a.map']);
        expect(flags['api-key']).toBe('k');
        expect(flags.sourcemap).toBe('/a.map');
    });
});

describe('runCli', () => {
    test('upload forwards parsed flags to uploadSourcemaps', async () => {
        await runCli([
            'upload',
            '--api-key',
            'k',
            '--sourcemap',
            '/a.map',
            '--bundle-filename',
            'main.jsbundle',
            '--version',
            'v1',
            '--api-endpoint',
            'https://example.test/api/sourcemaps',
        ]);
        expect(uploadSourcemaps).toHaveBeenCalledWith({
            apiKey: 'k',
            sourcemap: '/a.map',
            bundleFilename: 'main.jsbundle',
            version: 'v1',
            apiEndpoint: 'https://example.test/api/sourcemaps',
        });
    });

    test('falls back to FLARE_API_KEY when --api-key is absent', async () => {
        process.env.FLARE_API_KEY = 'env-key';
        await runCli(['upload', '--sourcemap', '/a.map']);
        expect(uploadSourcemaps).toHaveBeenCalledWith(
            expect.objectContaining({ apiKey: 'env-key', sourcemap: '/a.map' }),
        );
    });

    test('errors and sets exit code when --sourcemap is missing', async () => {
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        await runCli(['upload', '--api-key', 'k']);
        expect(uploadSourcemaps).not.toHaveBeenCalled();
        expect(process.exitCode).toBe(1);
        expect(err).toHaveBeenCalled();
    });

    test('errors and sets exit code on an unknown command', async () => {
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        await runCli(['frobnicate']);
        expect(process.exitCode).toBe(1);
        expect(err).toHaveBeenCalled();
    });
});

describe('runCli --auto', () => {
    test('skips with a banner when no api key is resolvable, and exits 0', async () => {
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        await runCli(['upload', '--sourcemap', '/a.map', '--auto']);
        expect(uploadSourcemaps).not.toHaveBeenCalled();
        expect(process.exitCode).toBeUndefined();
        expect(err.mock.calls.flat().join('\n')).toContain('FLARE SOURCEMAP UPLOAD FAILED');
    });

    test('skips with a banner when FLARE_SOURCEMAP_VERSION is unset, and exits 0', async () => {
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        await runCli(['upload', '--sourcemap', '/a.map', '--api-key', 'k', '--auto']);
        expect(uploadSourcemaps).not.toHaveBeenCalled();
        expect(process.exitCode).toBeUndefined();
        expect(err.mock.calls.flat().join('\n')).toContain('FLARE_SOURCEMAP_VERSION');
    });

    test('does not fall back to package.json for the version', async () => {
        // No env version set; even with a package.json present, auto mode must skip.
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        await runCli(['upload', '--sourcemap', '/a.map', '--api-key', 'k', '--auto']);
        expect(uploadSourcemaps).not.toHaveBeenCalled();
        expect(err).toHaveBeenCalled();
    });

    test('uploads under the env version and exits 0', async () => {
        process.env.FLARE_SOURCEMAP_VERSION = 'sha123';
        await runCli(['upload', '--sourcemap', '/a.map', '--api-key', 'k', '--auto']);
        expect(uploadSourcemaps).toHaveBeenCalledWith(
            expect.objectContaining({ apiKey: 'k', sourcemap: '/a.map', version: 'sha123' }),
        );
        expect(process.exitCode).toBeUndefined();
    });

    test('banners and exits 0 when the upload itself throws', async () => {
        process.env.FLARE_SOURCEMAP_VERSION = 'sha123';
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.mocked(uploadSourcemaps).mockRejectedValueOnce(new Error('Flare API returned 500'));
        await runCli(['upload', '--sourcemap', '/a.map', '--api-key', 'k', '--auto']);
        expect(process.exitCode).toBeUndefined();
        const printed = err.mock.calls.flat().join('\n');
        expect(printed).toContain('FLARE SOURCEMAP UPLOAD FAILED');
        expect(printed).toContain('Flare API returned 500');
    });

    test('resolves the api key from flare.json when no flag or env is set', async () => {
        process.env.FLARE_SOURCEMAP_VERSION = 'sha123';
        vi.mocked(readFlareConfig).mockReturnValueOnce({ apiKey: 'from-config' });
        await runCli(['upload', '--sourcemap', '/a.map', '--config', '/p/flare.json', '--auto']);
        expect(uploadSourcemaps).toHaveBeenCalledWith(
            expect.objectContaining({ apiKey: 'from-config', version: 'sha123' }),
        );
        expect(process.exitCode).toBeUndefined();
    });

    test('defaults --bundle-filename to the map basename when not given', async () => {
        process.env.FLARE_SOURCEMAP_VERSION = 'sha123';
        await runCli(['upload', '--sourcemap', '/build/index.android.bundle.map', '--api-key', 'k', '--auto']);
        // No bundleFilename passed -> uploadSourcemaps applies its own basename default.
        expect(uploadSourcemaps).toHaveBeenCalledWith(
            expect.objectContaining({ bundleFilename: undefined, sourcemap: '/build/index.android.bundle.map' }),
        );
    });
});
