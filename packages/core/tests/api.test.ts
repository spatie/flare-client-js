import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { Api } from '../src/api';

const minimalReport = {
    exceptionClass: 'Error',
    message: 'test',
    seenAtUnixNano: 0,
    stacktrace: [],
    events: [],
    attributes: {},
};

describe('Api.report', () => {
    const api = new Api();

    beforeEach(() => {
        vi.spyOn(globalThis, 'fetch');
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    test('sends POST with correct headers', async () => {
        vi.mocked(fetch).mockResolvedValue(new Response('', { status: 201 }));

        await api.report(minimalReport, 'https://example.com/ingest', 'test-key', false);

        expect(fetch).toHaveBeenCalledWith(
            'https://example.com/ingest',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({
                    'X-Api-Token': 'test-key',
                    'Content-Type': 'application/json',
                    'X-Flare-Client-Version': '2',
                }),
            }),
        );
    });

    test('does not log on 201 response', async () => {
        vi.mocked(fetch).mockResolvedValue(new Response('', { status: 201 }));
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        await api.report(minimalReport, 'https://example.com/ingest', 'test-key', false, true);

        expect(errorSpy).not.toHaveBeenCalled();
    });

    test('logs on non-201 response only when debug is true', async () => {
        vi.mocked(fetch).mockResolvedValue(new Response('', { status: 429 }));
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        await api.report(minimalReport, 'https://example.com/ingest', 'test-key', false, false);
        expect(errorSpy).not.toHaveBeenCalled();

        await api.report(minimalReport, 'https://example.com/ingest', 'test-key', false, true);
        expect(errorSpy).toHaveBeenCalledOnce();
    });

    test('swallows fetch rejection and logs when debug is true', async () => {
        vi.mocked(fetch).mockRejectedValue(new TypeError('network error'));
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        await api.report(minimalReport, 'https://example.com/ingest', 'test-key', false, true);

        expect(errorSpy).toHaveBeenCalledOnce();
    });

    test('swallows fetch rejection silently when debug is false', async () => {
        vi.mocked(fetch).mockRejectedValue(new TypeError('network error'));
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        await api.report(minimalReport, 'https://example.com/ingest', 'test-key', false, false);

        expect(errorSpy).not.toHaveBeenCalled();
    });

    test('uses empty string for null key', async () => {
        vi.mocked(fetch).mockResolvedValue(new Response('', { status: 201 }));

        await api.report(minimalReport, 'https://example.com/ingest', null, false);

        expect(fetch).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                headers: expect.objectContaining({
                    'X-Api-Token': '',
                }),
            }),
        );
    });
});
