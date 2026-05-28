import { describe, expect, it } from 'vitest';

import { NullFileReader } from '../src/stacktrace/NullFileReader';

describe('NullFileReader', () => {
    it('returns null for any URL', async () => {
        const reader = new NullFileReader();
        expect(await reader.read('https://example.com/foo.js')).toBeNull();
        expect(await reader.read('/local/path.ts')).toBeNull();
    });
});
