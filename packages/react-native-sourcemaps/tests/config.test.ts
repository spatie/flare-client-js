import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, test, vi } from 'vitest';

import { readFlareConfig } from '../src/config';

vi.mock('node:fs', () => ({ readFileSync: vi.fn() }));

afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
});

describe('readFlareConfig', () => {
    test('returns an empty config when no path is given (never reads cwd)', () => {
        expect(readFlareConfig()).toEqual({});
        expect(readFileSync).not.toHaveBeenCalled();
    });

    test('reads the exact path it is given', () => {
        vi.mocked(readFileSync).mockReturnValue(
            JSON.stringify({ apiKey: 'k', apiEndpoint: 'https://e.test/api/sourcemaps' }),
        );
        const config = readFlareConfig('/proj/flare.json');
        expect(readFileSync).toHaveBeenCalledWith('/proj/flare.json', 'utf8');
        expect(config).toEqual({ apiKey: 'k', apiEndpoint: 'https://e.test/api/sourcemaps' });
    });

    test('ignores a version key if present', () => {
        vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ apiKey: 'k', version: '9.9.9' }));
        expect(readFlareConfig('/p/flare.json')).toEqual({ apiKey: 'k' });
    });

    test('returns an empty config on a missing file', () => {
        vi.mocked(readFileSync).mockImplementation(() => {
            throw new Error('ENOENT');
        });
        expect(readFlareConfig('/nope/flare.json')).toEqual({});
    });

    test('returns an empty config on malformed JSON', () => {
        vi.mocked(readFileSync).mockReturnValue('{ not json');
        expect(readFlareConfig('/p/flare.json')).toEqual({});
    });

    test('treats empty-string values as absent', () => {
        vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ apiKey: '', apiEndpoint: '' }));
        expect(readFlareConfig('/p/flare.json')).toEqual({});
    });
});
