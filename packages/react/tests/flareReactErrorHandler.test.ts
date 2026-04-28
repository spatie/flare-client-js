import { beforeEach, describe, expect, test, vi } from 'vitest';

import { flareReactErrorHandler } from '../src/flareReactErrorHandler';

const mockReport = vi.fn();

vi.mock('@flareapp/js', () => ({
    flare: {
        report: (...args: unknown[]) => mockReport(...args),
    },
}));

beforeEach(() => {
    mockReport.mockClear();
});

describe('flareReactErrorHandler', () => {
    test('returns a callback function', () => {
        const handler = flareReactErrorHandler();

        expect(typeof handler).toBe('function');
    });

    test('reports an Error to flare', () => {
        const handler = flareReactErrorHandler();
        const error = new Error('test error');

        handler(error, { componentStack: '    at App' });

        expect(mockReport).toHaveBeenCalledOnce();
        expect(mockReport.mock.calls[0][0]).toBe(error);
    });

    test('converts non-Error values to Error before reporting', () => {
        const handler = flareReactErrorHandler();

        handler('string error', { componentStack: '    at App' });

        expect(mockReport).toHaveBeenCalledOnce();
        const reportedError = mockReport.mock.calls[0][0];
        expect(reportedError).toBeInstanceOf(Error);
        expect(reportedError.message).toBe('string error');
    });

    test('passes parsed component stack context to flare', () => {
        const handler = flareReactErrorHandler();
        const stack = `
            at ErrorComponent (http://localhost:5173/src/App.tsx:12:9)
            at div
            at App (http://localhost:5173/src/App.tsx:5:3)
        `;

        handler(new Error('test'), { componentStack: stack });

        const attributes = mockReport.mock.calls[0][1];
        expect((attributes['context.custom'] as any).react.componentStack).toEqual([
            'at ErrorComponent (http://localhost:5173/src/App.tsx:12:9)',
            'at div',
            'at App (http://localhost:5173/src/App.tsx:5:3)',
        ]);
        expect((attributes['context.custom'] as any).react.componentStackFrames).toEqual([
            { component: 'ErrorComponent', file: 'http://localhost:5173/src/App.tsx', line: 12, column: 9 },
            { component: 'div', file: null, line: null, column: null },
            { component: 'App', file: 'http://localhost:5173/src/App.tsx', line: 5, column: 3 },
        ]);
    });

    test('parses Firefox-format component stacks', () => {
        const handler = flareReactErrorHandler();
        const stack = `
            BuggyComponent@http://localhost:5173/react/BuggyComponent.tsx:17:9
            App@http://localhost:5173/react/App.tsx:26:45
        `;

        handler(new Error('test'), { componentStack: stack });

        const attributes = mockReport.mock.calls[0][1];
        expect((attributes['context.custom'] as any).react.componentStackFrames).toEqual([
            {
                component: 'BuggyComponent',
                file: 'http://localhost:5173/react/BuggyComponent.tsx',
                line: 17,
                column: 9,
            },
            { component: 'App', file: 'http://localhost:5173/react/App.tsx', line: 26, column: 45 },
        ]);
    });

    test('handles missing componentStack', () => {
        const handler = flareReactErrorHandler();

        handler(new Error('test'), {});

        const attributes = mockReport.mock.calls[0][1];
        expect((attributes['context.custom'] as any).react.componentStack).toEqual([]);
        expect((attributes['context.custom'] as any).react.componentStackFrames).toEqual([]);
    });

    test('works without options', () => {
        const handler = flareReactErrorHandler();

        expect(() => handler(new Error('test'), {})).not.toThrow();
        expect(mockReport).toHaveBeenCalledOnce();
    });

    describe('beforeEvaluate', () => {
        test('is called before building context', () => {
            const beforeEvaluate = vi.fn();
            const handler = flareReactErrorHandler({ beforeEvaluate });
            const error = new Error('test');
            const errorInfo = { componentStack: '    at App' };

            handler(error, errorInfo);

            expect(beforeEvaluate).toHaveBeenCalledOnce();
            expect(beforeEvaluate).toHaveBeenCalledWith({
                error,
                errorInfo,
            });
        });

        test('receives a converted Error when a non-Error value is thrown', () => {
            const beforeEvaluate = vi.fn();
            const handler = flareReactErrorHandler({ beforeEvaluate });

            handler('string error', { componentStack: '    at App' });

            const params = beforeEvaluate.mock.calls[0][0];
            expect(params.error).toBeInstanceOf(Error);
            expect(params.error.message).toBe('string error');
        });

        test('is called before flare.report', () => {
            const callOrder: string[] = [];

            mockReport.mockImplementation(() => callOrder.push('report'));

            const handler = flareReactErrorHandler({
                beforeEvaluate: () => callOrder.push('beforeEvaluate'),
            });

            handler(new Error('test'), {});

            expect(callOrder).toEqual(['beforeEvaluate', 'report']);
        });
    });

    describe('beforeSubmit', () => {
        test('is called with error, errorInfo, and context', () => {
            const beforeSubmit = vi.fn((params) => params.context);
            const handler = flareReactErrorHandler({ beforeSubmit });
            const error = new Error('test');
            const errorInfo = { componentStack: '\n    at App\n' };

            handler(error, errorInfo);

            expect(beforeSubmit).toHaveBeenCalledOnce();
            const params = beforeSubmit.mock.calls[0][0];
            expect(params.error).toBe(error);
            expect(params.errorInfo).toBe(errorInfo);
            expect(params.context.react.componentStack).toEqual(['at App']);
        });

        test('receives a converted Error when a non-Error value is thrown', () => {
            const beforeSubmit = vi.fn((params) => params.context);
            const handler = flareReactErrorHandler({ beforeSubmit });

            handler('string error', { componentStack: '    at App' });

            const params = beforeSubmit.mock.calls[0][0];
            expect(params.error).toBeInstanceOf(Error);
            expect(params.error.message).toBe('string error');
        });

        test('can modify the context before reporting', () => {
            const handler = flareReactErrorHandler({
                beforeSubmit: ({ context }) => ({
                    ...context,
                    react: {
                        ...context.react,
                        componentStack: ['modified'],
                    },
                }),
            });

            handler(new Error('test'), { componentStack: '    at App' });

            const reportedAttributes = mockReport.mock.calls[0][1];
            expect((reportedAttributes['context.custom'] as any).react.componentStack).toEqual(['modified']);
        });

        test('is called after beforeEvaluate and before flare.report', () => {
            const callOrder: string[] = [];

            mockReport.mockImplementation(() => callOrder.push('report'));

            const handler = flareReactErrorHandler({
                beforeEvaluate: () => callOrder.push('beforeEvaluate'),
                beforeSubmit: ({ context }) => {
                    callOrder.push('beforeSubmit');
                    return context;
                },
            });

            handler(new Error('test'), {});

            expect(callOrder).toEqual(['beforeEvaluate', 'beforeSubmit', 'report']);
        });
    });

    describe('afterSubmit', () => {
        test('is called with error, errorInfo, and final context', () => {
            const afterSubmit = vi.fn();
            const handler = flareReactErrorHandler({ afterSubmit });
            const error = new Error('test');
            const errorInfo = { componentStack: '\n    at App\n' };

            handler(error, errorInfo);

            expect(afterSubmit).toHaveBeenCalledOnce();
            const params = afterSubmit.mock.calls[0][0];
            expect(params.error).toBe(error);
            expect(params.errorInfo).toBe(errorInfo);
            expect(params.context.react.componentStack).toEqual(['at App']);
        });

        test('receives the modified context from beforeSubmit', () => {
            const afterSubmit = vi.fn();
            const handler = flareReactErrorHandler({
                beforeSubmit: ({ context }) => ({
                    ...context,
                    react: {
                        ...context.react,
                        componentStack: ['modified'],
                    },
                }),
                afterSubmit,
            });

            handler(new Error('test'), { componentStack: '    at App' });

            const params = afterSubmit.mock.calls[0][0];
            expect(params.context.react.componentStack).toEqual(['modified']);
        });

        test('is called after flare.report', () => {
            const callOrder: string[] = [];

            mockReport.mockImplementation(() => callOrder.push('report'));

            const handler = flareReactErrorHandler({
                afterSubmit: () => callOrder.push('afterSubmit'),
            });

            handler(new Error('test'), {});

            expect(callOrder).toEqual(['report', 'afterSubmit']);
        });
    });

    describe('all callbacks together', () => {
        test('executes in correct order: beforeEvaluate, beforeSubmit, report, afterSubmit', () => {
            const callOrder: string[] = [];

            mockReport.mockImplementation(() => callOrder.push('report'));

            const handler = flareReactErrorHandler({
                beforeEvaluate: () => callOrder.push('beforeEvaluate'),
                beforeSubmit: ({ context }) => {
                    callOrder.push('beforeSubmit');
                    return context;
                },
                afterSubmit: () => callOrder.push('afterSubmit'),
            });

            handler(new Error('test'), { componentStack: '    at App' });

            expect(callOrder).toEqual(['beforeEvaluate', 'beforeSubmit', 'report', 'afterSubmit']);
        });
    });

    describe('callback error propagation', () => {
        test('beforeEvaluate throwing prevents reporting and propagates to caller', () => {
            const handler = flareReactErrorHandler({
                beforeEvaluate: () => {
                    throw new Error('beforeEvaluate error');
                },
            });

            expect(() => handler(new Error('test'), {})).toThrow('beforeEvaluate error');
            expect(mockReport).not.toHaveBeenCalled();
        });

        test('beforeSubmit throwing prevents reporting and propagates to caller', () => {
            const handler = flareReactErrorHandler({
                beforeSubmit: () => {
                    throw new Error('beforeSubmit error');
                },
            });

            expect(() => handler(new Error('test'), {})).toThrow('beforeSubmit error');
            expect(mockReport).not.toHaveBeenCalled();
        });

        test('afterSubmit throwing propagates to caller after reporting', () => {
            const handler = flareReactErrorHandler({
                afterSubmit: () => {
                    throw new Error('afterSubmit error');
                },
            });

            expect(() => handler(new Error('test'), {})).toThrow('afterSubmit error');
            expect(mockReport).toHaveBeenCalledOnce();
        });
    });

    describe('beforeSubmit return value', () => {
        test('uses original context when beforeSubmit does not return', () => {
            const handler = flareReactErrorHandler({
                // @ts-expect-error -- intentionally testing a user mistake where beforeSubmit does not return
                beforeSubmit: () => {
                    // user forgot to return context
                },
            });

            handler(new Error('test'), { componentStack: '\n    at App\n' });

            const reportedAttributes = mockReport.mock.calls[0][1];
            expect((reportedAttributes['context.custom'] as any).react.componentStack).toEqual(['at App']);
            expect((reportedAttributes['context.custom'] as any).react.componentStackFrames).toBeInstanceOf(Array);
        });

        test('afterSubmit receives original context when beforeSubmit does not return', () => {
            const afterSubmit = vi.fn();
            const handler = flareReactErrorHandler({
                // @ts-expect-error -- intentionally testing a user mistake where beforeSubmit does not return
                beforeSubmit: () => {
                    // user forgot to return context
                },
                afterSubmit,
            });

            handler(new Error('test'), { componentStack: '\n    at App\n' });

            // afterSubmit still receives the FlareReactContext (not attributes), so the shape is unchanged
            expect(afterSubmit.mock.calls[0][0].context.react.componentStack).toEqual(['at App']);
        });
    });
});
