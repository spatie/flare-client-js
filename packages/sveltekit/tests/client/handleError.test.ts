import { beforeEach, describe, expect, test, vi } from 'vitest';

import { handleErrorWithFlare } from '../../src/client/handleError';

const mockReport = vi.fn();

vi.mock('@flareapp/js', () => ({
    toCustomContext: (framework: string, payload: unknown) => ({ 'context.custom': { [framework]: payload } }),
    convertToError: (e: unknown) => {
        if (e instanceof Error) return e;
        if (typeof e === 'string') return new Error(e);
        if (
            typeof e === 'object' &&
            e !== null &&
            'message' in e &&
            typeof (e as Record<string, unknown>).message === 'string'
        )
            return new Error((e as Record<string, string>).message);
        return new Error(String(e));
    },
    flare: {
        report: (...args: unknown[]) => mockReport(...args),
        reportSilently: (...args: unknown[]) => mockReport(...args),
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

describe('handleErrorWithFlare (client)', () => {
    test('returns a function', () => {
        const handler = handleErrorWithFlare();
        expect(typeof handler).toBe('function');
    });

    test('reports 5xx errors to flare', () => {
        const handler = handleErrorWithFlare();
        const error = new Error('server error');

        handler({ error, status: 500, message: 'Internal Error' });

        expect(mockReport).toHaveBeenCalledOnce();
        expect(mockReport.mock.calls[0][0]).toBeInstanceOf(Error);
        expect(mockReport.mock.calls[0][0].message).toBe('server error');
    });

    test('skips 4xx errors', () => {
        const handler = handleErrorWithFlare();

        handler({ error: new Error('not found'), status: 404, message: 'Not Found' });

        expect(mockReport).not.toHaveBeenCalled();
    });

    test('skips serialized expected errors with 4xx status on error object', () => {
        const handler = handleErrorWithFlare();

        handler({ error: { status: 404, message: 'Not Found' }, status: 500, message: 'Internal Error' });

        expect(mockReport).not.toHaveBeenCalled();
    });

    test('skips SvelteKit wrapped expected errors', () => {
        const handler = handleErrorWithFlare();

        handler({
            error: { type: 'error', error: { message: 'This page does not exist' }, status: 404 },
            status: 500,
            message: 'Internal Error',
        });

        expect(mockReport).not.toHaveBeenCalled();
    });

    test('unwraps SvelteKit error wrapper for message extraction', () => {
        const handler = handleErrorWithFlare();

        handler({
            error: { type: 'error', error: { message: 'Server load function error' }, status: 500 },
            status: 500,
            message: 'Internal Error',
        });

        expect(mockReport).toHaveBeenCalledOnce();
        expect(mockReport.mock.calls[0][0].message).toBe('Server load function error');
    });

    test('passes svelteKit context in attributes', () => {
        const handler = handleErrorWithFlare();

        handler({ error: new Error('test'), status: 500, message: 'Internal Error' });

        const attributes = mockReport.mock.calls[0][1];
        expect(attributes['context.custom'].svelte).toBeDefined();
        expect(attributes['context.custom'].svelte.svelteKit).toBeDefined();
        expect(attributes['context.custom'].svelte.svelteKit.status).toBe(500);
        expect(attributes['context.custom'].svelte.svelteKit.message).toBe('Internal Error');
    });

    test('passes through to user handler', () => {
        const userHandler = vi.fn();
        const handler = handleErrorWithFlare(userHandler);

        handler({ error: new Error('test'), status: 500, message: 'Internal Error' });

        expect(userHandler).toHaveBeenCalledOnce();
        expect(mockReport).toHaveBeenCalledOnce();
    });

    test('calls user handler for 4xx errors without reporting', () => {
        const userHandler = vi.fn();
        const handler = handleErrorWithFlare(userHandler);

        handler({ error: new Error('not found'), status: 404, message: 'Not Found' });

        expect(userHandler).toHaveBeenCalledOnce();
        expect(mockReport).not.toHaveBeenCalled();
    });

    test('accepts options with hooks', () => {
        const callOrder: string[] = [];

        mockReport.mockImplementation(() => {
            callOrder.push('report');
        });

        const handler = handleErrorWithFlare({
            beforeEvaluate: () => callOrder.push('beforeEvaluate'),
            beforeSubmit: ({ context }) => {
                callOrder.push('beforeSubmit');
                return context;
            },
            afterSubmit: () => callOrder.push('afterSubmit'),
        });

        handler({ error: new Error('test'), status: 500, message: 'Internal Error' });

        expect(callOrder).toEqual(['beforeEvaluate', 'beforeSubmit', 'report', 'afterSubmit']);
    });

    test('converts non-Error values', () => {
        const handler = handleErrorWithFlare();

        handler({ error: 'string error', status: 500, message: 'Internal Error' });

        expect(mockReport.mock.calls[0][0]).toBeInstanceOf(Error);
        expect(mockReport.mock.calls[0][0].message).toBe('string error');
    });

    test('swallows report rejection', async () => {
        mockReport.mockRejectedValueOnce(new Error('network error'));
        const handler = handleErrorWithFlare();

        handler({ error: new Error('test'), status: 500, message: 'Internal Error' });

        await new Promise((r) => setTimeout(r, 0));
    });
});
