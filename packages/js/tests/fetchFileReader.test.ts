/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FetchFileReader } from '../src/browser/FetchFileReader';

const originalFetch = global.fetch;

describe('FetchFileReader', () => {
    afterEach(() => {
        global.fetch = originalFetch;
    });

    it('rejects non-http(s) URLs', async () => {
        const reader = new FetchFileReader();
        expect(await reader.read('chrome-extension://x/y.js')).toBeNull();
        expect(await reader.read('file:///etc/passwd')).toBeNull();
    });

    it('returns body for http urls', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            status: 200,
            text: () => Promise.resolve('hello'),
        }) as any;
        const reader = new FetchFileReader();
        expect(await reader.read('https://example.com/x.js')).toBe('hello');
    });

    it('returns null on non-200', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            status: 404,
            text: () => Promise.resolve(''),
        }) as any;
        const reader = new FetchFileReader();
        expect(await reader.read('https://example.com/x.js')).toBeNull();
    });
});
