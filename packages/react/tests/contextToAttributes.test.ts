import { describe, expect, test } from 'vitest';

import { contextToAttributes } from '../src/contextToAttributes';
import { FlareReactContext } from '../src/types';

describe('contextToAttributes', () => {
    test('wraps react context (with version) under context.custom', () => {
        const context: FlareReactContext = {
            react: {
                componentStack: ['at App', 'at div'],
                componentStackFrames: [{ component: 'App', file: 'App.tsx', line: 5, column: 3 }],
                version: '19.0.0',
            },
        };

        const attributes = contextToAttributes(context);

        expect(attributes).toEqual({
            'context.custom': {
                react: {
                    componentStack: ['at App', 'at div'],
                    componentStackFrames: [{ component: 'App', file: 'App.tsx', line: 5, column: 3 }],
                    version: '19.0.0',
                },
            },
        });
    });

    test('forwards minifiedError when present', () => {
        const context: FlareReactContext = {
            react: {
                componentStack: [],
                componentStackFrames: [],
                version: '19.0.0',
                minifiedError: { number: 418, args: ['Foo'], url: 'https://react.dev/errors/418?args[]=Foo' },
            },
        };

        const attributes = contextToAttributes(context);

        expect((attributes['context.custom'] as any).react.minifiedError).toEqual({
            number: 418,
            args: ['Foo'],
            url: 'https://react.dev/errors/418?args[]=Foo',
        });
    });

    test('omits minifiedError when absent', () => {
        const context: FlareReactContext = {
            react: {
                componentStack: [],
                componentStackFrames: [],
                version: '19.0.0',
            },
        };

        const attributes = contextToAttributes(context);

        expect((attributes['context.custom'] as any).react).not.toHaveProperty('minifiedError');
    });

    test('omits version when a context has none (e.g. a beforeSubmit literal)', () => {
        const context: FlareReactContext = {
            react: {
                componentStack: [],
                componentStackFrames: [],
            },
        };

        const attributes = contextToAttributes(context);

        expect((attributes['context.custom'] as any).react).not.toHaveProperty('version');
    });
});
