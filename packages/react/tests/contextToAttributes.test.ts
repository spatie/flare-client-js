import { describe, expect, test } from 'vitest';

import { contextToAttributes } from '../src/contextToAttributes';
import { FlareReactContext } from '../src/types';

describe('contextToAttributes', () => {
    test('wraps react context under context.custom with framework identifier', () => {
        const context: FlareReactContext = {
            react: {
                componentStack: ['at App', 'at div'],
                componentStackFrames: [{ component: 'App', file: 'App.tsx', line: 5, column: 3 }],
            },
        };

        const attributes = contextToAttributes(context);

        expect(attributes).toEqual({
            'context.custom': {
                framework: 'react',
                react: {
                    componentStack: ['at App', 'at div'],
                    componentStackFrames: [{ component: 'App', file: 'App.tsx', line: 5, column: 3 }],
                },
            },
        });
    });

    test('handles empty component stack', () => {
        const context: FlareReactContext = {
            react: {
                componentStack: [],
                componentStackFrames: [],
            },
        };

        const attributes = contextToAttributes(context);

        expect(attributes['context.custom']).toEqual({
            framework: 'react',
            react: {
                componentStack: [],
                componentStackFrames: [],
            },
        });
    });
});
