import { beforeEach, describe, expect, test, vi } from 'vitest';

import { createFlareErrorHandler } from '../src/createFlareErrorHandler';
import type { FlareSvelteContext } from '../src/types';

const mockReport = vi.fn();

vi.mock('@flareapp/js', () => ({
    flare: {
        report: (...args: unknown[]) => mockReport(...args),
        setSdkInfo: vi.fn(),
        setFramework: vi.fn(),
        addContext: vi.fn(),
    },
}));

beforeEach(() => {
    mockReport.mockClear();
});

describe('createFlareErrorHandler', () => {
    test('returns a function', () => {
        const handler = createFlareErrorHandler();
        expect(typeof handler).toBe('function');
    });

    test('reports an Error to flare', async () => {
        const handler = createFlareErrorHandler();
        const error = new Error('test error');

        await handler(error, () => {});

        expect(mockReport).toHaveBeenCalledOnce();
        expect(mockReport.mock.calls[0][0]).toBe(error);
    });

    test('converts non-Error values to Error before reporting', async () => {
        const handler = createFlareErrorHandler();

        await handler('string error', () => {});

        expect(mockReport).toHaveBeenCalledOnce();
        const reportedError = mockReport.mock.calls[0][0];
        expect(reportedError).toBeInstanceOf(Error);
        expect(reportedError.message).toBe('string error');
    });

    test('passes enriched svelte context in attributes', async () => {
        const handler = createFlareErrorHandler();

        await handler(new Error('test'), () => {});

        const attributes = mockReport.mock.calls[0][1];
        const svelte = attributes['context.custom'].svelte;
        expect(svelte.componentName).toBeDefined();
        expect(svelte.componentHierarchy).toBeInstanceOf(Array);
        expect(svelte.errorOrigin).toBeDefined();
        expect(attributes['context.custom'].framework).toBe('svelte');
    });

    test('calls beforeEvaluate with converted error', async () => {
        const beforeEvaluate = vi.fn();
        const handler = createFlareErrorHandler({ beforeEvaluate });
        const error = new Error('test');

        await handler(error, () => {});

        expect(beforeEvaluate).toHaveBeenCalledOnce();
        expect(beforeEvaluate).toHaveBeenCalledWith({ error });
    });

    test('calls beforeSubmit with error and enriched context, uses returned context', async () => {
        const customContext: FlareSvelteContext = {
            svelte: {
                componentName: 'Custom',
                componentHierarchy: ['Custom'],
                errorOrigin: 'render',
            },
        };
        const beforeSubmit = vi.fn().mockReturnValue(customContext);
        const handler = createFlareErrorHandler({ beforeSubmit });

        await handler(new Error('test'), () => {});

        expect(beforeSubmit).toHaveBeenCalledOnce();
        const params = beforeSubmit.mock.calls[0][0];
        expect(params.error).toBeInstanceOf(Error);
        expect(params.context.svelte.componentName).toBeDefined();
        expect(params.context.svelte.errorOrigin).toBeDefined();

        const attributes = mockReport.mock.calls[0][1];
        expect(attributes['context.custom']).toEqual({
            framework: 'svelte',
            svelte: customContext.svelte,
        });
    });

    test('calls afterSubmit with error and final context', async () => {
        const afterSubmit = vi.fn();
        const handler = createFlareErrorHandler({ afterSubmit });
        const error = new Error('test');

        await handler(error, () => {});

        expect(afterSubmit).toHaveBeenCalledOnce();
        const params = afterSubmit.mock.calls[0][0];
        expect(params.error).toBe(error);
        expect(params.context.svelte.componentName).toBeDefined();
        expect(params.context.svelte.errorOrigin).toBeDefined();
    });

    test('calls hooks in order: beforeEvaluate, beforeSubmit, report, afterSubmit', async () => {
        const callOrder: string[] = [];

        mockReport.mockImplementation(() => {
            callOrder.push('report');
        });

        const handler = createFlareErrorHandler({
            beforeEvaluate: () => callOrder.push('beforeEvaluate'),
            beforeSubmit: ({ context }) => {
                callOrder.push('beforeSubmit');
                return context;
            },
            afterSubmit: () => callOrder.push('afterSubmit'),
        });

        await handler(new Error('test'), () => {});

        expect(callOrder).toEqual(['beforeEvaluate', 'beforeSubmit', 'report', 'afterSubmit']);
    });

    test('works with no options', async () => {
        const handler = createFlareErrorHandler();

        await handler(new Error('test'), () => {});

        expect(mockReport).toHaveBeenCalledOnce();
    });

    test('swallows report rejection', async () => {
        mockReport.mockRejectedValueOnce(new Error('network error'));
        const handler = createFlareErrorHandler();

        await handler(new Error('test'), () => {});

        await new Promise((r) => setTimeout(r, 0));
    });
});
