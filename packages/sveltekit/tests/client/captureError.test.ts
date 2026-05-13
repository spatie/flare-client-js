import { beforeEach, describe, expect, test, vi } from 'vitest';

import { captureError } from '../../src/client/captureError';

const mockReport = vi.fn();

vi.mock('@flareapp/js', () => ({
    flare: {
        report: (...args: unknown[]) => mockReport(...args),
        setSdkInfo: vi.fn(),
        setFramework: vi.fn(),
        addContext: vi.fn(),
    },
    DEFAULT_URL_DENYLIST:
        /password|passwd|pwd|token|secret|authorization|\bauth\b|bearer|oauth|credentials?|cookie|api[-_]?key|private[-_]?key|session|csrf|xsrf|\bpin\b|\bssn\b|card[-_]?number|\bcvv\b/i,
}));

vi.mock('@flareapp/svelte', () => ({}));

vi.mock('$app/state', () => ({
    page: {
        url: new URL('http://localhost/test'),
        params: {},
        route: { id: '/test' },
    },
}));

beforeEach(() => {
    mockReport.mockClear();
});

describe('captureError (client)', () => {
    test('reports error to flare', () => {
        const error = new Error('test error');
        captureError(error);

        expect(mockReport).toHaveBeenCalledOnce();
        expect(mockReport.mock.calls[0][0]).toBe(error);
    });

    test('converts non-Error values', () => {
        captureError('string error');

        expect(mockReport.mock.calls[0][0]).toBeInstanceOf(Error);
        expect(mockReport.mock.calls[0][0].message).toBe('string error');
    });

    test('always includes route context', () => {
        captureError(new Error('test'));

        const attributes = mockReport.mock.calls[0][1];
        expect(attributes['context.custom'].svelte.svelteKit).toBeDefined();
        expect(attributes['context.custom'].svelte.svelteKit.routeId).toBe('/test');
    });

    test('includes status and message when provided', () => {
        captureError(new Error('test'), { status: 500, message: 'Internal Error' });

        const attributes = mockReport.mock.calls[0][1];
        expect(attributes['context.custom'].svelte.svelteKit.status).toBe(500);
        expect(attributes['context.custom'].svelte.svelteKit.message).toBe('Internal Error');
    });

    test('works without options', () => {
        captureError(new Error('test'));

        expect(mockReport).toHaveBeenCalledOnce();
    });
});
