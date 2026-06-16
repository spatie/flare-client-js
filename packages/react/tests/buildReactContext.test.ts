import { version as reactVersion } from 'react';
import { describe, expect, test } from 'vitest';

import { buildReactContext } from '../src/buildReactContext';

const stack = '\n    at App (http://localhost:5173/src/App.tsx:5:3)\n';

describe('buildReactContext', () => {
    test('includes the React version on every context', () => {
        const context = buildReactContext(stack, new Error('plain error'));

        expect(context.react.version).toBe(reactVersion);
    });

    test('parses component stack into componentStack and componentStackFrames', () => {
        const context = buildReactContext(stack, new Error('plain error'));

        expect(context.react.componentStack).toEqual(['at App (http://localhost:5173/src/App.tsx:5:3)']);
        expect(context.react.componentStackFrames).toEqual([
            { component: 'App', file: 'http://localhost:5173/src/App.tsx', line: 5, column: 3 },
        ]);
    });

    test('omits minifiedError for a plain error', () => {
        const context = buildReactContext(stack, new Error('plain error'));

        expect(context.react.minifiedError).toBeUndefined();
    });

    test('attaches minifiedError for a minified React error', () => {
        const error = new Error(
            'Minified React error #418; visit https://react.dev/errors/418?args[]=Foo for the full message',
        );

        const context = buildReactContext(stack, error);

        expect(context.react.minifiedError).toEqual({
            number: 418,
            args: ['Foo'],
            url: 'https://react.dev/errors/418?args[]=Foo',
        });
    });
});
