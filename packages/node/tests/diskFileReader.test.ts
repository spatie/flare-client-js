import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

// nativeImport hides node: specifiers from bundlers via new Function.
// Vitest's module runner cannot resolve those, so we swap it for a plain
// dynamic import that vitest can handle.
vi.mock('../src/stacktrace/nativeImport', () => ({
    nativeImport: (specifier: string) => import(specifier),
}));

import { DiskFileReader } from '../src/stacktrace/DiskFileReader';

describe('DiskFileReader', () => {
    it('reads a real file from disk by absolute path', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'flare-test-'));
        const file = join(dir, 'sample.js');
        writeFileSync(file, 'hello\nworld');
        const reader = new DiskFileReader();
        expect(await reader.read(file)).toBe('hello\nworld');
    });

    it('reads a file:// URL', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'flare-test-'));
        const file = join(dir, 'sample.js');
        writeFileSync(file, 'x');
        const reader = new DiskFileReader();
        expect(await reader.read(pathToFileURL(file).href)).toBe('x');
    });

    it('returns null for http urls', async () => {
        const reader = new DiskFileReader();
        expect(await reader.read('https://example.com/x.js')).toBeNull();
    });

    it('returns null for missing files', async () => {
        const reader = new DiskFileReader();
        expect(await reader.read('/definitely/not/a/file.js')).toBeNull();
    });
});
