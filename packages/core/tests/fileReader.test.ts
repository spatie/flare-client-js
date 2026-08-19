import { beforeEach, describe, expect, it } from 'vitest';

import { __clearFileReaderCacheForTests, getCodeSnippet, readLinesFromFile } from '../src/stacktrace/fileReader';
import type { FileReader } from '../src/stacktrace/fileReader';

class StubReader implements FileReader {
    constructor(private map: Record<string, string | null>) {}
    read(url: string): Promise<string | null> {
        return Promise.resolve(this.map[url] ?? null);
    }
}

describe('getCodeSnippet', () => {
    beforeEach(() => __clearFileReaderCacheForTests());

    it('returns an error message when url is missing', async () => {
        const reader = new StubReader({});
        const res = await getCodeSnippet(reader, undefined, 1, 1);
        expect(res.codeSnippet[0]).toContain('missing file URL');
    });

    it('returns the line and surrounding context', async () => {
        const reader = new StubReader({ 'a.js': 'a\nb\nc\nd\ne' });
        const res = await getCodeSnippet(reader, 'a.js', 3, 1);
        expect(res.codeSnippet[3]).toBe('c');
        expect(res.codeSnippet[2]).toBe('b');
        expect(res.codeSnippet[4]).toBe('d');
    });

    it('caches reads', async () => {
        let calls = 0;
        const reader: FileReader = {
            read(_url: string) {
                calls += 1;
                return Promise.resolve('x\ny\nz');
            },
        };
        await getCodeSnippet(reader, 'a.js', 2, 1);
        await getCodeSnippet(reader, 'a.js', 2, 1);
        expect(calls).toBe(1);
    });

    it('reads a file once when every frame of a report asks for it at the same time', async () => {
        let calls = 0;
        const pending: Array<(text: string) => void> = [];
        const reader: FileReader = {
            read(_url: string) {
                calls += 1;
                return new Promise<string | null>((resolve) => pending.push(resolve));
            },
        };

        const snippets = Promise.all([
            getCodeSnippet(reader, 'a.js', 1, 1),
            getCodeSnippet(reader, 'a.js', 2, 1),
            getCodeSnippet(reader, 'a.js', 3, 1),
        ]);
        for (const resolve of pending) {
            resolve('x\ny\nz');
        }
        await snippets;

        expect(calls).toBe(1);
    });

    it('does not cache a failed read, so a later report can try again', async () => {
        let calls = 0;
        const reader: FileReader = {
            read(_url: string) {
                calls += 1;
                return Promise.resolve(calls === 1 ? null : 'x\ny\nz');
            },
        };

        const first = await getCodeSnippet(reader, 'a.js', 2, 1);
        expect(first.codeSnippet[0]).toContain('Could not read from file');

        const second = await getCodeSnippet(reader, 'a.js', 2, 1);
        expect(second.codeSnippet[2]).toBe('y');
        expect(calls).toBe(2);
    });
});

describe('readLinesFromFile', () => {
    it('truncates very long lines from the start', () => {
        const long = 'x'.repeat(2000);
        const res = readLinesFromFile(long, 1);
        expect(res.codeSnippet[1].length).toBeLessThanOrEqual(1001);
        expect(res.codeSnippet[1].endsWith('…')).toBe(true);
    });
});
