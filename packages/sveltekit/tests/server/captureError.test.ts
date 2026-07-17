import { beforeEach, describe, expect, test, vi } from 'vitest';

import { captureError } from '../../src/server/captureError';

const mockReport = vi.fn();

vi.mock('@flareapp/js', () => ({
    toCustomContext: (framework: string, payload: unknown) => ({ 'context.custom': { [framework]: payload } }),
    convertToError: (e: unknown) => (e instanceof Error ? e : new Error(String(e))),
    DEFAULT_URL_DENYLIST:
        /password|passwd|pwd|token|secret|authorization|\bauth\b|bearer|oauth|credentials?|cookie|api[-_]?key|private[-_]?key|session|csrf|xsrf|\bpin\b|\bssn\b|card[-_]?number|\bcvv\b/i,
    flare: {
        report: (...args: unknown[]) => mockReport(...args),
        reportSilently: (...args: unknown[]) => mockReport(...args),
        setSdkInfo: vi.fn(),
        setFramework: vi.fn(),
        addContext: vi.fn(),
    },
}));

vi.mock('@flareapp/svelte', () => ({}));

beforeEach(() => {
    mockReport.mockClear();
});

describe('captureError (server)', () => {
    test('reports error to flare', async () => {
        const error = new Error('test error');
        await captureError(error);

        expect(mockReport).toHaveBeenCalledOnce();
        expect(mockReport.mock.calls[0][0]).toBe(error);
    });

    test('converts non-Error values', async () => {
        await captureError('string error');

        expect(mockReport.mock.calls[0][0]).toBeInstanceOf(Error);
        expect(mockReport.mock.calls[0][0].message).toBe('string error');
    });

    test('includes status and message when provided', async () => {
        await captureError(new Error('test'), { status: 500, message: 'Internal Error' });

        const attributes = mockReport.mock.calls[0][1];
        expect(attributes['context.custom'].svelte.svelteKit.status).toBe(500);
        expect(attributes['context.custom'].svelte.svelteKit.message).toBe('Internal Error');
    });

    test('works without options', async () => {
        await captureError(new Error('test'));

        expect(mockReport).toHaveBeenCalledOnce();
        const attributes = mockReport.mock.calls[0][1];
        expect(attributes['context.custom'].svelte.svelteKit).toBeDefined();
        expect(attributes['context.custom'].svelte.svelteKit.routeId).toBeNull();
    });
});
