import { cleanup, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { FlareSvelteContext } from '../src/types';
import BoundaryWithBuggyChild from './fixtures/BoundaryWithBuggyChild.svelte';
import BoundaryWithChildren from './fixtures/BoundaryWithChildren.svelte';
import BoundaryWithoutFallback from './fixtures/BoundaryWithoutFallback.svelte';

const mockReport = vi.fn();

vi.mock('@flareapp/js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@flareapp/js')>();
    return {
        ...actual,
        flare: {
            report: (...args: unknown[]) => mockReport(...args),
            reportSilently: (...args: unknown[]) => mockReport(...args),
            setSdkInfo: vi.fn(),
            setFramework: vi.fn(),
            addContext: vi.fn(),
        },
    };
});

afterEach(() => {
    cleanup();
});

beforeEach(() => {
    mockReport.mockClear();
});

describe('FlareErrorBoundary', () => {
    test('renders children when no error occurs', () => {
        const { getByText } = render(BoundaryWithChildren);
        expect(getByText('Hello world')).toBeTruthy();
    });

    test('catches error and renders fallback', () => {
        const { getByTestId } = render(BoundaryWithBuggyChild);
        expect(getByTestId('error-message').textContent).toBe('Error: BuggyComponent render error');
    });

    test('reports error to Flare on catch', async () => {
        render(BoundaryWithBuggyChild);
        await new Promise((r) => setTimeout(r, 0));
        expect(mockReport).toHaveBeenCalledOnce();
        expect(mockReport.mock.calls[0][0]).toBeInstanceOf(Error);
        expect(mockReport.mock.calls[0][0].message).toBe('BuggyComponent render error');
    });

    test('passes svelte context in attributes', async () => {
        render(BoundaryWithBuggyChild);
        await new Promise((r) => setTimeout(r, 0));
        const attributes = mockReport.mock.calls[0][1];
        expect(attributes['context.custom'].svelte).toBeDefined();
        expect(attributes['context.custom'].svelte.componentName).toBeDefined();
        expect(attributes['context.custom'].svelte.componentHierarchy).toBeInstanceOf(Array);
        expect(attributes['context.custom'].svelte.errorOrigin).toBeDefined();
    });

    test('calls beforeEvaluate with error', () => {
        const beforeEvaluate = vi.fn();
        render(BoundaryWithBuggyChild, { props: { beforeEvaluate } });
        expect(beforeEvaluate).toHaveBeenCalledOnce();
        expect(beforeEvaluate.mock.calls[0][0].error).toBeInstanceOf(Error);
    });

    test('calls beforeSubmit with error and context, uses returned context', async () => {
        const customContext: FlareSvelteContext = {
            svelte: {
                componentName: 'Custom',
                componentHierarchy: ['Custom'],
                errorOrigin: 'render',
            },
        };
        const beforeSubmit = vi.fn().mockReturnValue(customContext);
        render(BoundaryWithBuggyChild, { props: { beforeSubmit } });
        await new Promise((r) => setTimeout(r, 0));
        expect(beforeSubmit).toHaveBeenCalledOnce();
        const params = beforeSubmit.mock.calls[0][0];
        expect(params.error).toBeInstanceOf(Error);
        expect(params.context.svelte.componentName).toBeDefined();
        expect(params.context.svelte.errorOrigin).toBeDefined();
        const attributes = mockReport.mock.calls[0][1];
        expect(attributes['context.custom']).toEqual({
            svelte: customContext.svelte,
        });
    });

    test('calls afterSubmit with error and context', async () => {
        const afterSubmit = vi.fn();
        render(BoundaryWithBuggyChild, { props: { afterSubmit } });
        await new Promise((r) => setTimeout(r, 0));
        expect(afterSubmit).toHaveBeenCalledOnce();
        expect(afterSubmit.mock.calls[0][0].error).toBeInstanceOf(Error);
        expect(afterSubmit.mock.calls[0][0].context.svelte.componentName).toBeDefined();
        expect(afterSubmit.mock.calls[0][0].context.svelte.errorOrigin).toBeDefined();
    });

    test('calls hooks in order: beforeEvaluate, beforeSubmit, report, afterSubmit', async () => {
        const callOrder: string[] = [];
        mockReport.mockImplementation(() => {
            callOrder.push('report');
        });
        render(BoundaryWithBuggyChild, {
            props: {
                beforeEvaluate: () => callOrder.push('beforeEvaluate'),
                beforeSubmit: ({ context }: { context: FlareSvelteContext }) => {
                    callOrder.push('beforeSubmit');
                    return context;
                },
                afterSubmit: () => callOrder.push('afterSubmit'),
            },
        });
        await new Promise((r) => setTimeout(r, 0));
        expect(callOrder).toEqual(['beforeEvaluate', 'beforeSubmit', 'report', 'afterSubmit']);
    });

    test('swallows report rejection', async () => {
        mockReport.mockRejectedValueOnce(new Error('network error'));
        render(BoundaryWithBuggyChild);
        await new Promise((r) => setTimeout(r, 0));
    });

    test('reset clears error and re-renders children', async () => {
        const { getByTestId, getByText, rerender } = render(BoundaryWithBuggyChild);
        expect(getByTestId('error-message')).toBeTruthy();
        await rerender({ shouldThrow: false });
        getByTestId('reset-button').click();
        await tick();
        expect(getByText('Child rendered successfully')).toBeTruthy();
    });

    test('calls onReset with the error when resetting', async () => {
        const onReset = vi.fn();
        const { getByTestId, rerender } = render(BoundaryWithBuggyChild, { props: { onReset } });
        await rerender({ shouldThrow: false, onReset });
        getByTestId('reset-button').click();
        await tick();
        expect(onReset).toHaveBeenCalledOnce();
        expect(onReset.mock.calls[0][0]).toBeInstanceOf(Error);
    });

    test('content removed silently when no fallback snippet provided', async () => {
        const { container } = render(BoundaryWithoutFallback);
        await new Promise((r) => setTimeout(r, 0));
        expect(mockReport).toHaveBeenCalledOnce();
        expect(container.textContent?.trim()).toBe('');
    });

    test('resetKeys change triggers reset when in error state', async () => {
        const onReset = vi.fn();
        const { getByText, rerender } = render(BoundaryWithBuggyChild, {
            props: { resetKeys: ['a'], onReset, shouldThrow: true },
        });
        await new Promise((r) => setTimeout(r, 0));
        expect(mockReport).toHaveBeenCalledOnce();

        await rerender({ resetKeys: ['b'], onReset, shouldThrow: false });
        await tick();
        expect(onReset).toHaveBeenCalledOnce();
        expect(onReset.mock.calls[0][0]).toBeInstanceOf(Error);
        expect(getByText('Child rendered successfully')).toBeTruthy();
    });

    test('resetKeys change does nothing when no error', async () => {
        const onReset = vi.fn();
        const { getByText, rerender } = render(BoundaryWithBuggyChild, {
            props: { resetKeys: ['a'], onReset, shouldThrow: false },
        });
        expect(getByText('Child rendered successfully')).toBeTruthy();

        await rerender({ resetKeys: ['b'], onReset, shouldThrow: false });
        await tick();
        expect(onReset).not.toHaveBeenCalled();
        expect(getByText('Child rendered successfully')).toBeTruthy();
    });

    test('does not capture props by default', async () => {
        render(BoundaryWithBuggyChild);
        await new Promise((r) => setTimeout(r, 0));
        const attributes = mockReport.mock.calls[0][1];
        expect(attributes['context.custom'].svelte.componentProps).toBeUndefined();
    });

    test('captures serialized props when attachProps is true', async () => {
        render(BoundaryWithBuggyChild, {
            props: { attachProps: true, shouldThrow: true },
        });
        await new Promise((r) => setTimeout(r, 0));
        const attributes = mockReport.mock.calls[0][1];
        expect(attributes['context.custom'].svelte.componentProps).toBeDefined();
        expect(typeof attributes['context.custom'].svelte.componentProps).toBe('object');
    });
});
