import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, test, vi } from 'vitest';

import { resolveVersion } from '../src/version';

vi.mock('node:fs', () => ({ readFileSync: vi.fn() }));

afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    delete process.env.FLARE_SOURCEMAP_VERSION;
});

describe('resolveVersion', () => {
    test('prefers an explicit version over the env var', () => {
        process.env.FLARE_SOURCEMAP_VERSION = 'from-env';
        expect(resolveVersion({ version: 'from-flag' })).toBe('from-flag');
    });

    test('uses FLARE_SOURCEMAP_VERSION when no explicit version is given', () => {
        process.env.FLARE_SOURCEMAP_VERSION = 'from-env';
        expect(resolveVersion()).toBe('from-env');
    });

    test('falls back to package.json version with a warning', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ version: '9.9.9' }));
        expect(resolveVersion({ cwd: '/proj' })).toBe('9.9.9');
        expect(warn).toHaveBeenCalledTimes(1);
    });

    test('throws when no version can be resolved', () => {
        vi.mocked(readFileSync).mockImplementation(() => {
            throw new Error('ENOENT');
        });
        expect(() => resolveVersion({ cwd: '/proj' })).toThrow(/Could not resolve a sourcemap version/);
    });
});
