import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { FlareErrorBoundary } from '../src/FlareErrorBoundary';

const mockReport = vi.fn();

vi.mock('@flareapp/js', () => ({
    flare: {
        report: (...args: unknown[]) => mockReport(...args),
    },
}));

let testError: Error;

function ThrowingComponent({ shouldThrow = true }: { shouldThrow?: boolean }) {
    if (shouldThrow) {
        throw testError;
    }

    return <div>No error</div>;
}

describe('FlareErrorBoundary', () => {
    // React logs caught errors to console.error -- suppress during tests
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        testError = new Error('test error');
        mockReport.mockClear();
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
        cleanup();
    });

    test('renders children when there is no error', () => {
        render(
            <FlareErrorBoundary>
                <div>Hello</div>
            </FlareErrorBoundary>
        );

        expect(screen.getByText('Hello')).toBeInTheDocument();
    });

    test('reports the error to flare', () => {
        render(
            <FlareErrorBoundary fallback={<div>Error</div>}>
                <ThrowingComponent />
            </FlareErrorBoundary>
        );

        expect(mockReport).toHaveBeenCalledOnce();
        expect(mockReport.mock.calls[0][0]).toBe(testError);
    });

    test('passes react context with componentStack and componentStackFrames', () => {
        render(
            <FlareErrorBoundary fallback={<div>Error</div>}>
                <ThrowingComponent />
            </FlareErrorBoundary>
        );

        const context = mockReport.mock.calls[0][1];

        expect(context.react.componentStack).toBeInstanceOf(Array);
        expect(context.react.componentStack.length).toBeGreaterThan(0);
        expect(context.react.componentStack.some((entry: string) => entry.includes('ThrowingComponent'))).toBe(true);

        expect(context.react.componentStackFrames).toBeInstanceOf(Array);
        expect(context.react.componentStackFrames.length).toBeGreaterThan(0);
        expect(
            context.react.componentStackFrames.some(
                (frame: { component: string }) => frame.component === 'ThrowingComponent'
            )
        ).toBe(true);
    });

    test('passes errorInfo as extra solution parameters', () => {
        render(
            <FlareErrorBoundary fallback={<div>Error</div>}>
                <ThrowingComponent />
            </FlareErrorBoundary>
        );

        const extraParams = mockReport.mock.calls[0][2];
        expect(extraParams.react.errorInfo).toBeDefined();
        expect(extraParams.react.errorInfo.componentStack).toEqual(expect.any(String));
    });

    test('renders nothing when no fallback is provided', () => {
        const { container } = render(
            <FlareErrorBoundary>
                <ThrowingComponent />
            </FlareErrorBoundary>
        );

        expect(container.innerHTML).toBe('');
    });

    test('renders a static fallback element', () => {
        render(
            <FlareErrorBoundary fallback={<div>Something went wrong</div>}>
                <ThrowingComponent />
            </FlareErrorBoundary>
        );

        expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    });

    test('renders a fallback function with error, componentStack, and resetErrorBoundary', () => {
        const fallbackFn = vi.fn(({ error, componentStack, resetErrorBoundary }) => (
            <div>
                <span data-testid="error-message">{error.message}</span>
                <span data-testid="has-stack">{componentStack.length > 0 ? 'yes' : 'no'}</span>
                <button onClick={resetErrorBoundary}>Reset</button>
            </div>
        ));

        render(
            <FlareErrorBoundary fallback={fallbackFn}>
                <ThrowingComponent />
            </FlareErrorBoundary>
        );

        expect(fallbackFn).toHaveBeenCalled();
        expect(screen.getByTestId('error-message')).toHaveTextContent('test error');
        expect(screen.getByTestId('has-stack')).toHaveTextContent('yes');
    });

    test('calls beforeEvaluate before reporting', () => {
        const callOrder: string[] = [];

        const beforeEvaluate = vi.fn(() => callOrder.push('beforeEvaluate'));
        mockReport.mockImplementationOnce(() => callOrder.push('report'));

        render(
            <FlareErrorBoundary fallback={<div>Error</div>} beforeEvaluate={beforeEvaluate}>
                <ThrowingComponent />
            </FlareErrorBoundary>
        );

        expect(beforeEvaluate).toHaveBeenCalledOnce();
        expect(callOrder).toEqual(['beforeEvaluate', 'report']);
    });

    test('calls beforeEvaluate with error and errorInfo', () => {
        const beforeEvaluate = vi.fn();

        render(
            <FlareErrorBoundary fallback={<div>Error</div>} beforeEvaluate={beforeEvaluate}>
                <ThrowingComponent />
            </FlareErrorBoundary>
        );

        expect(beforeEvaluate.mock.calls[0][0].error).toBe(testError);
        expect(beforeEvaluate.mock.calls[0][0].errorInfo).toBeDefined();
    });

    test('calls onError after reporting', () => {
        const callOrder: string[] = [];

        mockReport.mockImplementationOnce(() => callOrder.push('report'));
        const onError = vi.fn((_params: { error: Error; errorInfo: unknown }) => {
            callOrder.push('onError');
        });

        render(
            <FlareErrorBoundary fallback={<div>Error</div>} onError={onError}>
                <ThrowingComponent />
            </FlareErrorBoundary>
        );

        expect(onError).toHaveBeenCalledOnce();
        expect(onError.mock.calls[0][0].error).toBe(testError);
        expect(onError.mock.calls[0][0].errorInfo).toBeDefined();
        expect(callOrder).toEqual(['report', 'onError']);
    });

    test('resetErrorBoundary clears the error and re-renders children', () => {
        let shouldThrow = true;

        function MaybeThrow() {
            if (shouldThrow) {
                throw testError;
            }
            return <div>Recovered</div>;
        }

        render(
            <FlareErrorBoundary
                fallback={({ resetErrorBoundary }) => <button onClick={resetErrorBoundary}>Reset</button>}
            >
                <MaybeThrow />
            </FlareErrorBoundary>
        );

        expect(screen.getByText('Reset')).toBeInTheDocument();

        shouldThrow = false;
        fireEvent.click(screen.getByText('Reset'));

        expect(screen.getByText('Recovered')).toBeInTheDocument();
    });

    test('calls onReset with the previous error when resetting', () => {
        const onReset = vi.fn();
        let shouldThrow = true;

        function MaybeThrow() {
            if (shouldThrow) {
                throw testError;
            }
            return <div>OK</div>;
        }

        render(
            <FlareErrorBoundary
                onReset={onReset}
                fallback={({ resetErrorBoundary }) => <button onClick={resetErrorBoundary}>Reset</button>}
            >
                <MaybeThrow />
            </FlareErrorBoundary>
        );

        shouldThrow = false;
        fireEvent.click(screen.getByText('Reset'));

        expect(onReset).toHaveBeenCalledOnce();
        expect(onReset).toHaveBeenCalledWith(testError);
    });

    test('resets automatically when resetKeys change', () => {
        const onReset = vi.fn();
        let shouldThrow = true;

        function MaybeThrow() {
            if (shouldThrow) {
                throw testError;
            }
            return <div>Recovered</div>;
        }

        const { rerender } = render(
            <FlareErrorBoundary onReset={onReset} resetKeys={['a']} fallback={<div>Error</div>}>
                <MaybeThrow />
            </FlareErrorBoundary>
        );

        expect(screen.getByText('Error')).toBeInTheDocument();

        shouldThrow = false;

        rerender(
            <FlareErrorBoundary onReset={onReset} resetKeys={['b']} fallback={<div>Error</div>}>
                <MaybeThrow />
            </FlareErrorBoundary>
        );

        expect(onReset).toHaveBeenCalledOnce();
        expect(screen.getByText('Recovered')).toBeInTheDocument();
    });

    test('does not reset when resetKeys stay the same', () => {
        const onReset = vi.fn();

        render(
            <FlareErrorBoundary onReset={onReset} resetKeys={['a']} fallback={<div>Error</div>}>
                <ThrowingComponent />
            </FlareErrorBoundary>
        );

        expect(screen.getByText('Error')).toBeInTheDocument();
        expect(onReset).not.toHaveBeenCalled();
    });

    test('reports again when component throws after reset', () => {
        render(
            <FlareErrorBoundary
                fallback={({ resetErrorBoundary }) => <button onClick={resetErrorBoundary}>Reset</button>}
            >
                <ThrowingComponent />
            </FlareErrorBoundary>
        );

        expect(mockReport).toHaveBeenCalledOnce();

        // Component will throw again after reset
        fireEvent.click(screen.getByText('Reset'));

        expect(mockReport).toHaveBeenCalledTimes(2);
        expect(screen.getByText('Reset')).toBeInTheDocument();
    });

    test('beforeEvaluate throwing prevents reporting and crashes the boundary', () => {
        const beforeEvaluate = vi.fn(() => {
            throw new Error('beforeEvaluate error');
        });

        // beforeEvaluate throwing inside componentDidCatch propagates the error
        // through React, which escalates it and unmounts the tree.
        // There is no try/catch around the callback in componentDidCatch.
        expect(() =>
            render(
                <FlareErrorBoundary fallback={<div>Error</div>} beforeEvaluate={beforeEvaluate}>
                    <ThrowingComponent />
                </FlareErrorBoundary>
            )
        ).toThrow('beforeEvaluate error');

        expect(beforeEvaluate).toHaveBeenCalledOnce();
        expect(mockReport).not.toHaveBeenCalled();
    });
});
