// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterAll, beforeAll, expect, test, vi } from 'vitest';

// Production hides `node:` specifiers behind a Function-built import so browser bundlers don't try to
// resolve them. That opacity also defeats vitest's module runner, so we swap it for a plain dynamic
// import (which vitest can resolve) to exercise the real disk-read path.
vi.mock('../src/stacktrace/nativeImport', () => ({
    nativeImport: (specifier: string) => import(specifier),
}));

import { getCodeSnippet } from '../src/stacktrace/fileReader';

let dir: string;

beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'flare-filereader-'));
});

afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
});

test('getCodeSnippet reads a local file from disk by absolute path in Node', async () => {
    const file = join(dir, 'absolute.ts');
    writeFileSync(file, 'const a = 1;\nthrow new Error("boom");\nconst b = 2;\n');

    const result = await getCodeSnippet(file, 2);

    expect(result.codeSnippet[2]).toBe('throw new Error("boom");');
});

test('getCodeSnippet reads a local file from a file:// URL in Node', async () => {
    const file = join(dir, 'fileurl.ts');
    writeFileSync(file, 'line one\nline two\nline three\n');
    const url = pathToFileURL(file).href;

    const result = await getCodeSnippet(url, 3);

    expect(result.codeSnippet[3]).toBe('line three');
});

test('getCodeSnippet returns a read error when the local file does not exist', async () => {
    const result = await getCodeSnippet(join(dir, 'does-not-exist.ts'), 1);

    expect(result.codeSnippet[0]).toContain('Could not read from file');
});
