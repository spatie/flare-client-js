// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { getCodeSnippet, readLinesFromFile } from '../src/stacktrace/fileReader';

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
    originalFetch = globalThis.fetch;
});

afterEach(() => {
    globalThis.fetch = originalFetch;
});

test('getCodeSnippet caches file by URL across calls', async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
        calls++;
        return new Response('alpha\nbeta\ngamma', { status: 200 });
    }) as typeof globalThis.fetch;

    await getCodeSnippet('https://example.test/cached.js', 2);
    await getCodeSnippet('https://example.test/cached.js', 2);

    expect(calls).toBe(1);
});

test('readLinesFromFile labels target line as the requested 1-based line number', () => {
    const text = 'L1\nL2\nL3\nL4\nL5';

    const { codeSnippet } = readLinesFromFile(text, 3);

    expect(codeSnippet[3]).toBe('L3');
});

test('readLinesFromFile centers snippet symmetrically around target line', () => {
    // 41-line file, target line 21 -> snippet should cover lines 1..41 (target in middle).
    const text = Array.from({ length: 41 }, (_, i) => `L${i + 1}`).join('\n');

    const { codeSnippet } = readLinesFromFile(text, 21);

    expect(codeSnippet[1]).toBe('L1');
    expect(codeSnippet[21]).toBe('L21');
    expect(codeSnippet[41]).toBe('L41');
});

test('getCodeSnippet skips non-http(s) URLs without fetching', async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
        calls++;
        return new Response('', { status: 200 });
    }) as typeof globalThis.fetch;

    const result = await getCodeSnippet('chrome-extension://abcdef/script.js', 1);

    expect(calls).toBe(0);
    expect(result.codeSnippet[0]).toContain('Could not read');
});
