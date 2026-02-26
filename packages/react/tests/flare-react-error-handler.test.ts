import { beforeEach, describe, expect, test, vi } from 'vitest';

import { flareReactErrorHandler } from '../src/flare-react-error-handler';

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

        const context = mockReport.mock.calls[0][1];
        expect(context.react.componentStack).toEqual([
            'at ErrorComponent (http://localhost:5173/src/App.tsx:12:9)',
            'at div',
            'at App (http://localhost:5173/src/App.tsx:5:3)',
        ]);
        expect(context.react.componentStackFrames).toEqual([
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

        const context = mockReport.mock.calls[0][1];
        expect(context.react.componentStackFrames).toEqual([
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

        const context = mockReport.mock.calls[0][1];
        expect(context.react.componentStack).toEqual([]);
        expect(context.react.componentStackFrames).toEqual([]);
    });

    test('calls the user-provided callback', () => {
        const callback = vi.fn();
        const handler = flareReactErrorHandler(callback);
        const error = new Error('test');
        const errorInfo = { componentStack: '    at App' };

        handler(error, errorInfo);

        expect(callback).toHaveBeenCalledOnce();
        expect(callback).toHaveBeenCalledWith(error, errorInfo);
    });

    test('works without a callback', () => {
        const handler = flareReactErrorHandler();

        expect(() => handler(new Error('test'), {})).not.toThrow();
        expect(mockReport).toHaveBeenCalledOnce();
    });
});
