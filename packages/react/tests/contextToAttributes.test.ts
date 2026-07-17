import { version as reactVersion } from 'react';
import { describe, expect, test } from 'vitest';

import { contextToAttributes } from '../src/contextToAttributes';
import { FlareReactContext, MinifiedReactError } from '../src/types';

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

    test('emits flare.exception.react_minified_error when a minified error is passed', () => {
        const context: FlareReactContext = {
            react: { componentStack: [], componentStackFrames: [], version: '19.0.0' },
        };
        const minifiedError: MinifiedReactError = {
            number: 418,
            args: ['Foo'],
            url: 'https://react.dev/errors/418?args[]=Foo',
        };

        const attributes = contextToAttributes(context, minifiedError);
        const field = attributes['flare.exception.react_minified_error'] as any;

        expect(field.number).toBe(418);
        expect(field.args).toEqual(['Foo']);
        expect(field.url).toBe('https://react.dev/errors/418?args[]=Foo');
        expect(typeof field.react_version).toBe('string');
        expect(field.react_version.length).toBeGreaterThan(0);
    });

    test('omits the flare.exception.react_minified_error key entirely when no minified error is passed', () => {
        const context: FlareReactContext = {
            react: { componentStack: [], componentStackFrames: [], version: '19.0.0' },
        };

        const attributes = contextToAttributes(context);

        expect(attributes).not.toHaveProperty('flare.exception.react_minified_error');
    });

    test('never carries minifiedError inside context.custom.react', () => {
        const context: FlareReactContext = {
            react: { componentStack: [], componentStackFrames: [], version: '19.0.0' },
        };
        const minifiedError: MinifiedReactError = {
            number: 418,
            args: ['Foo'],
            url: 'https://react.dev/errors/418?args[]=Foo',
        };

        const withError = contextToAttributes(context, minifiedError);
        const withoutError = contextToAttributes(context);

        expect((withError['context.custom'] as any).react).not.toHaveProperty('minifiedError');
        expect((withoutError['context.custom'] as any).react).not.toHaveProperty('minifiedError');
    });

    test('populates react_version even when the context carries no version', () => {
        // A beforeSubmit hook that returns a fresh literal can drop context.react.version.
        // react_version must NOT depend on it: it is read from React's own version export.
        const context: FlareReactContext = {
            react: { componentStack: [], componentStackFrames: [] },
        };
        const minifiedError: MinifiedReactError = { number: 418, args: [], url: null };

        const attributes = contextToAttributes(context, minifiedError);
        const field = attributes['flare.exception.react_minified_error'] as any;

        expect(field.react_version).toBe(reactVersion);
        expect((attributes['context.custom'] as any).react).not.toHaveProperty('version');
    });
});
