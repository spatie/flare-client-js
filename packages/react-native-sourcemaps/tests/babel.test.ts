import { transformSync } from '@babel/core';
import { afterEach, describe, expect, test, vi } from 'vitest';

import flareSourcemapsBabelPlugin from '../src/babel';

const RUNTIME = '@flareapp/react-native-sourcemaps/runtime';

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
    test('inlines the imported flareSourcemapVersion and drops the import', () => {
        const out = transform(
            `import { flareSourcemapVersion } from '${RUNTIME}';\nconst v = flareSourcemapVersion;`,
            'abc123',
        );
        expect(out).toContain('"abc123"');
        expect(out).not.toContain('flareSourcemapVersion');
        expect(out).not.toContain(RUNTIME);
    });

    test('handles an aliased import', () => {
        const out = transform(`import { flareSourcemapVersion as ver } from '${RUNTIME}';\nconst v = ver;`, 'xyz');
        expect(out).toContain('"xyz"');
        expect(out).not.toContain(RUNTIME);
    });

    test('leaves unrelated imports and identifiers untouched', () => {
        const out = transform(
            `import { foo } from 'somewhere';\nconst flareSourcemapVersion = 1;\nconst a = foo + flareSourcemapVersion;`,
            'abc123',
        );
        expect(out).toContain("from 'somewhere'");
        expect(out).toContain('foo');
        // The local const (not imported from our runtime) must NOT be inlined.
        expect(out).not.toContain('"abc123"');
    });

    test('resolves the version independently for each transform (pre() reset)', () => {
        const code = `import { flareSourcemapVersion } from '${RUNTIME}';\nexport const v = flareSourcemapVersion;`;
        const first = transform(code, 'v1');
        const second = transform(code, 'v2');
        expect(first).toContain('"v1"');
        expect(second).toContain('"v2"');
    });
});
