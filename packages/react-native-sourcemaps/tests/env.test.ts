import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { loadEnvFiles } from '../src/env';

let dir: string;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'flare-env-'));
});

afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.FLARE_API_KEY;
    delete process.env.FLARE_API_ENDPOINT;
    delete process.env.FLARE_SOURCEMAP_VERSION;
    delete process.env.FLARE_QUOTED;
    delete process.env.SOME_OTHER_SECRET;
});

function write(file: string, contents: string): void {
    writeFileSync(join(dir, file), contents);
}

describe('loadEnvFiles', () => {
    test('loads FLARE_* keys from .env.local', () => {
        write('.env.local', 'FLARE_API_KEY=abc123\n');
        loadEnvFiles(dir);
        expect(process.env.FLARE_API_KEY).toBe('abc123');
    });

    test('only loads FLARE_-prefixed keys (never unrelated secrets)', () => {
        write('.env.local', 'FLARE_API_KEY=abc123\nSOME_OTHER_SECRET=leak\n');
        loadEnvFiles(dir);
        expect(process.env.FLARE_API_KEY).toBe('abc123');
        expect(process.env.SOME_OTHER_SECRET).toBeUndefined();
    });

    test('does not overwrite an already-set env value (explicit export wins)', () => {
        process.env.FLARE_API_KEY = 'from-shell';
        write('.env.local', 'FLARE_API_KEY=from-file\n');
        loadEnvFiles(dir);
        expect(process.env.FLARE_API_KEY).toBe('from-shell');
    });

    test('.env.local wins over .env for the same key', () => {
        write('.env', 'FLARE_API_KEY=from-env\n');
        write('.env.local', 'FLARE_API_KEY=from-local\n');
        loadEnvFiles(dir);
        expect(process.env.FLARE_API_KEY).toBe('from-local');
    });

    test('falls back to .env when .env.local is absent', () => {
        write('.env', 'FLARE_API_KEY=from-env\n');
        loadEnvFiles(dir);
        expect(process.env.FLARE_API_KEY).toBe('from-env');
    });

    test('ignores comments and blank lines, supports `export ` and quotes', () => {
        write(
            '.env.local',
            [
                '# a comment',
                '',
                'export FLARE_API_KEY=k1',
                'FLARE_QUOTED="q v"',
                "FLARE_API_ENDPOINT='https://e.test'",
            ].join('\n'),
        );
        loadEnvFiles(dir);
        expect(process.env.FLARE_API_KEY).toBe('k1');
        expect(process.env.FLARE_QUOTED).toBe('q v');
        expect(process.env.FLARE_API_ENDPOINT).toBe('https://e.test');
    });

    test('is a no-op when neither file exists', () => {
        expect(() => loadEnvFiles(dir)).not.toThrow();
        expect(process.env.FLARE_API_KEY).toBeUndefined();
    });
});
