import { readFileSync } from 'node:fs';

import { FlareApi } from '@flareapp/flare-api';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { uploadSourcemaps } from '../src/uploadSourcemaps';

vi.mock('@flareapp/flare-api');
vi.mock('node:fs', () => ({ readFileSync: vi.fn() }));

afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
});

describe('uploadSourcemaps', () => {
    test('uploads the map under the resolved version and default bundle filename', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.mocked(readFileSync).mockReturnValue('MAP_CONTENT');
        const uploadSourcemap = vi.fn().mockResolvedValue(undefined);
        vi.mocked(FlareApi).mockImplementation(function () {
            return { uploadSourcemap } as unknown as FlareApi;
        });

        await uploadSourcemaps({
            apiKey: 'key',
            sourcemap: '/build/index.android.bundle.map',
            version: 'v1',
        });

        expect(FlareApi).toHaveBeenCalledWith('https://flareapp.io/api/sourcemaps', 'key', 'v1');
        expect(uploadSourcemap).toHaveBeenCalledWith({
            originalFile: 'index.android.bundle',
            content: 'MAP_CONTENT',
        });
    });

    test('honours an explicit bundle filename and api endpoint', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.mocked(readFileSync).mockReturnValue('MAP');
        const uploadSourcemap = vi.fn().mockResolvedValue(undefined);
        vi.mocked(FlareApi).mockImplementation(function () {
            return { uploadSourcemap } as unknown as FlareApi;
        });

        await uploadSourcemaps({
            apiKey: 'key',
            sourcemap: '/build/x.map',
            bundleFilename: 'main.jsbundle',
            apiEndpoint: 'https://example.test/api/sourcemaps',
            version: 'v2',
        });

        expect(FlareApi).toHaveBeenCalledWith('https://example.test/api/sourcemaps', 'key', 'v2');
        expect(uploadSourcemap).toHaveBeenCalledWith({ originalFile: 'main.jsbundle', content: 'MAP' });
    });

    test('warns and no-ops without an api key', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await uploadSourcemaps({ apiKey: '', sourcemap: '/build/x.map' });
        expect(FlareApi).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledTimes(1);
    });
});
