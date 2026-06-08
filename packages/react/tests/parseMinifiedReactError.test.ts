import { describe, expect, test } from 'vitest';

import { parseMinifiedReactError } from '../src/parseMinifiedReactError';

describe('parseMinifiedReactError', () => {
    test('parses a React 18/19 message (react.dev URL)', () => {
        const error = new Error(
            'Minified React error #418; visit https://react.dev/errors/418?args[]=Foo&args[]=Bar for the full message',
        );

        expect(parseMinifiedReactError(error)).toEqual({
            number: 418,
            args: ['Foo', 'Bar'],
            url: 'https://react.dev/errors/418?args[]=Foo&args[]=Bar',
        });
    });

    test('parses a React 16/17 message (reactjs.org error-decoder URL)', () => {
        const error = new Error(
            'Minified React error #185; visit https://reactjs.org/docs/error-decoder.html?invariant=185&args[]=Foo for the full message',
        );

        expect(parseMinifiedReactError(error)).toEqual({
            number: 185,
            args: ['Foo'],
            url: 'https://reactjs.org/docs/error-decoder.html?invariant=185&args[]=Foo',
        });
    });

    test('returns null for a non-minified error message', () => {
        expect(parseMinifiedReactError(new Error('Cannot read properties of undefined'))).toBeNull();
    });

    test('handles a minified message with no args', () => {
        const error = new Error('Minified React error #310; visit https://react.dev/errors/310 for the full message');

        expect(parseMinifiedReactError(error)).toEqual({
            number: 310,
            args: [],
            url: 'https://react.dev/errors/310',
        });
    });

    test('URL-decodes arg values', () => {
        const error = new Error(
            'Minified React error #418; visit https://react.dev/errors/418?args[]=%3Cdiv%3E&args[]=%20%26%20 for the full message',
        );

        expect(parseMinifiedReactError(error)).toEqual({
            number: 418,
            args: ['<div>', ' & '],
            url: 'https://react.dev/errors/418?args[]=%3Cdiv%3E&args[]=%20%26%20',
        });
    });

    test('returns null for an empty message without throwing', () => {
        expect(parseMinifiedReactError(new Error(''))).toBeNull();
    });

    test('falls back to the raw arg value when percent-decoding fails', () => {
        const error = new Error(
            'Minified React error #418; visit https://react.dev/errors/418?args[]=%E0%A4%A&args[]=ok for the full message',
        );

        // `%E0%A4%A` is a malformed percent escape; decodeURIComponent would throw.
        // The parser must not throw mid-error-handling and keeps the raw value instead.
        expect(parseMinifiedReactError(error)).toEqual({
            number: 418,
            args: ['%E0%A4%A', 'ok'],
            url: 'https://react.dev/errors/418?args[]=%E0%A4%A&args[]=ok',
        });
    });
});
