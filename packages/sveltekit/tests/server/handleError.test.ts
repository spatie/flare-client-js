import { beforeEach, describe, expect, test, vi } from 'vitest';

import { handleErrorWithFlare } from '../../src/server/handleError';

const mockReport = vi.fn();

vi.mock('@flareapp/js', () => ({
    flare: {
        report: (...args: unknown[]) => mockReport(...args),
        setSdkInfo: vi.fn(),
        setFramework: vi.fn(),
        addContext: vi.fn(),
    },
}));

vi.mock('@flareapp/svelte', () => ({}));

beforeEach(() => {
    mockReport.mockClear();
});

describe('handleErrorWithFlare (server)', () => {
    test('returns a function', () => {
        const handler = handleErrorWithFlare();
        expect(typeof handler).toBe('function');
    });

    test('reports 5xx errors to flare', async () => {
        const handler = handleErrorWithFlare();
        const error = new Error('server error');

        await handler({ error, status: 500, message: 'Internal Error' });

        expect(mockReport).toHaveBeenCalledOnce();
        expect(mockReport.mock.calls[0][0].message).toBe('server error');
    });

    test('skips 4xx errors', async () => {
        const handler = handleErrorWithFlare();

        await handler({ error: new Error('not found'), status: 404, message: 'Not Found' });

        expect(mockReport).not.toHaveBeenCalled();
    });

    test('passes svelteKit context in attributes', async () => {
        const handler = handleErrorWithFlare();

        await handler({ error: new Error('test'), status: 500, message: 'Internal Error' });

        const attributes = mockReport.mock.calls[0][1];
        expect(attributes['context.custom'].framework).toBe('svelte');
        expect(attributes['context.custom'].svelte.svelteKit.status).toBe(500);
        expect(attributes['context.custom'].svelte.svelteKit.message).toBe('Internal Error');
    });

    test('passes through to user handler', async () => {
        const userHandler = vi.fn();
        const handler = handleErrorWithFlare(userHandler);

        await handler({ error: new Error('test'), status: 500, message: 'Internal Error' });

        expect(userHandler).toHaveBeenCalledOnce();
        expect(mockReport).toHaveBeenCalledOnce();
    });

    test('calls user handler for 4xx errors without reporting', async () => {
        const userHandler = vi.fn();
        const handler = handleErrorWithFlare(userHandler);

        await handler({ error: new Error('not found'), status: 404, message: 'Not Found' });

        expect(userHandler).toHaveBeenCalledOnce();
        expect(mockReport).not.toHaveBeenCalled();
    });

    test('calls hooks in order: beforeEvaluate, beforeSubmit, report, afterSubmit', async () => {
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

        await handler({ error: new Error('test'), status: 500, message: 'Internal Error' });

        expect(callOrder).toEqual(['beforeEvaluate', 'beforeSubmit', 'report', 'afterSubmit']);
    });

    test('converts non-Error values', async () => {
        const handler = handleErrorWithFlare();

        await handler({ error: 'string error', status: 500, message: 'Internal Error' });

        expect(mockReport.mock.calls[0][0]).toBeInstanceOf(Error);
        expect(mockReport.mock.calls[0][0].message).toBe('string error');
    });

    test('swallows report rejection', async () => {
        mockReport.mockRejectedValueOnce(new Error('network error'));
        const handler = handleErrorWithFlare();

        await handler({ error: new Error('test'), status: 500, message: 'Internal Error' });

        await new Promise((r) => setTimeout(r, 0));
    });
});
