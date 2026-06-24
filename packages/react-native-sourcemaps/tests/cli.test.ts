import { afterEach, describe, expect, test, vi } from 'vitest';

import { parseArgs, runCli } from '../src/cli';
import { uploadSourcemaps } from '../src/uploadSourcemaps';

vi.mock('../src/uploadSourcemaps', () => ({ uploadSourcemaps: vi.fn().mockResolvedValue(undefined) }));

afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    process.exitCode = undefined;
    delete process.env.FLARE_API_KEY;
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
