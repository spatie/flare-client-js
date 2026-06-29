import { describe, expect, test } from 'vitest';

import { flareSourcemapVersion } from '../src/runtime';

describe('flareSourcemapVersion', () => {
    test('defaults to an empty string when the Babel plugin has not inlined it', () => {
        // Without the Babel transform the source value is the empty-string default,
        // which is harmless: sourcemaps are only uploaded for release builds.
        expect(flareSourcemapVersion).toBe('');
    });
});
