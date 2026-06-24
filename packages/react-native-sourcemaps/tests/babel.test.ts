import { transformSync } from '@babel/core';
import { afterEach, describe, expect, test, vi } from 'vitest';

import flareSourcemapsBabelPlugin from '../src/babel';

function transform(code: string, version: string | undefined): string {
    const previous = process.env.FLARE_SOURCEMAP_VERSION;
    if (version === undefined) {
        delete process.env.FLARE_SOURCEMAP_VERSION;
    } else {
        process.env.FLARE_SOURCEMAP_VERSION = version;
    }
    try {
        const result = transformSync(code, {
            plugins: [flareSourcemapsBabelPlugin],
            babelrc: false,
            configFile: false,
        });
        return result?.code ?? '';
    } finally {
        if (previous === undefined) {
            delete process.env.FLARE_SOURCEMAP_VERSION;
        } else {
            process.env.FLARE_SOURCEMAP_VERSION = previous;
        }
    }
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('flareSourcemapsBabelPlugin', () => {
    test('replaces process.env.FLARE_SOURCEMAP_VERSION with the resolved version literal', () => {
        const out = transform('const v = process.env.FLARE_SOURCEMAP_VERSION;', 'abc123');
        expect(out).toContain('"abc123"');
        expect(out).not.toContain('process.env.FLARE_SOURCEMAP_VERSION');
    });

    test('leaves other process.env reads untouched', () => {
        const out = transform('const a = process.env.OTHER_VAR;', 'abc123');
        expect(out).toContain('process.env.OTHER_VAR');
    });

    test('handles computed access process.env["FLARE_SOURCEMAP_VERSION"]', () => {
        const out = transform('const v = process.env["FLARE_SOURCEMAP_VERSION"];', 'xyz');
        expect(out).toContain('"xyz"');
    });
});
