import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { FlareApi } from '../src/FlareApi';

describe('FlareApi', () => {
    beforeEach(() => {
        vi.spyOn(globalThis, 'fetch');
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    describe('uploadSourcemap', () => {
        test('sends compressed sourcemap content to endpoint', async () => {
            vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 200 }));

            const api = new FlareApi('https://flare.test/api/sourcemaps', 'test-key', 'v1');
            await api.uploadSourcemap({
                originalFile: '/assets/app.js',
                content: '{"version":3}',
            });

            expect(fetch).toHaveBeenCalledWith(
                'https://flare.test/api/sourcemaps',
                expect.objectContaining({
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                })
            );

            const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
            expect(body.key).toBe('test-key');
            expect(body.version_id).toBe('v1');
            expect(body.relative_filename).toBe('/assets/app.js');
            expect(body.sourcemap).toEqual(expect.any(String));
        });
    });

    describe('retry logic', () => {
        test('retries on 429 with exponential backoff', async () => {
            vi.mocked(fetch)
                .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
                .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
                .mockResolvedValueOnce(new Response('{}', { status: 200 }));

            const api = new FlareApi('https://flare.test/api', 'key', 'v1');
            const promise = api.uploadSourcemap({
                originalFile: '/app.js',
                content: '{}',
            });

            await vi.advanceTimersByTimeAsync(1000);
            await vi.advanceTimersByTimeAsync(2000);

            await promise;

            expect(fetch).toHaveBeenCalledTimes(3);
        });

        test('retries on 502/503/504', async () => {
            vi.mocked(fetch)
                .mockResolvedValueOnce(new Response('', { status: 502 }))
                .mockResolvedValueOnce(new Response('{}', { status: 200 }));

            const api = new FlareApi('https://flare.test/api', 'key', 'v1');
            const promise = api.uploadSourcemap({
                originalFile: '/app.js',
                content: '{}',
            });

            await vi.advanceTimersByTimeAsync(1000);
            await promise;

            expect(fetch).toHaveBeenCalledTimes(2);
        });

        test('does NOT retry on 400/401/403/404', async () => {
            vi.mocked(fetch).mockResolvedValue(new Response('bad request', { status: 400 }));

            const api = new FlareApi('https://flare.test/api', 'key', 'v1');

            await expect(api.uploadSourcemap({ originalFile: '/app.js', content: '{}' })).rejects.toThrow(
                'Flare API returned 400'
            );

            expect(fetch).toHaveBeenCalledTimes(1);
        });

        test('retries on network error', async () => {
            vi.mocked(fetch)
                .mockRejectedValueOnce(new TypeError('fetch failed'))
                .mockResolvedValueOnce(new Response('{}', { status: 200 }));

            const api = new FlareApi('https://flare.test/api', 'key', 'v1');
            const promise = api.uploadSourcemap({
                originalFile: '/app.js',
                content: '{}',
            });

            await vi.advanceTimersByTimeAsync(1000);
            await promise;

            expect(fetch).toHaveBeenCalledTimes(2);
        });

        test('throws after max retries exhausted', async () => {
            vi.mocked(fetch).mockResolvedValue(new Response('', { status: 503 }));

            const api = new FlareApi('https://flare.test/api', 'key', 'v1');
            const promise = api.uploadSourcemap({
                originalFile: '/app.js',
                content: '{}',
            });

            const rejection = expect(promise).rejects.toThrow('after 3 attempts');

            await vi.advanceTimersByTimeAsync(1000);
            await vi.advanceTimersByTimeAsync(2000);

            await rejection;
            expect(fetch).toHaveBeenCalledTimes(3);
        });
    });
});
