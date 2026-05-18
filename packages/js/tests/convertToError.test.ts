import { describe, expect, test } from 'vitest';

import { convertToError } from '../src';

describe('convertToError', () => {
    test('returns the same Error instance if given an Error', () => {
        const error = new Error('original');

        const result = convertToError(error);

        expect(result).toBe(error);
        expect(result.message).toBe('original');
    });

    test('returns Error subclass instances as-is', () => {
        const error = new TypeError('type error');

        const result = convertToError(error);

        expect(result).toBe(error);
        expect(result).toBeInstanceOf(TypeError);
    });

    test('wraps a string in an Error', () => {
        const result = convertToError('something went wrong');

        expect(result).toBeInstanceOf(Error);
        expect(result.message).toBe('something went wrong');
    });

    test('wraps an empty string in an Error', () => {
        const result = convertToError('');

        expect(result).toBeInstanceOf(Error);
        expect(result.message).toBe('');
    });

    test('wraps a number in an Error via String()', () => {
        const result = convertToError(42);

        expect(result).toBeInstanceOf(Error);
        expect(result.message).toBe('42');
    });

    test('wraps null in an Error', () => {
        const result = convertToError(null);

        expect(result).toBeInstanceOf(Error);
        expect(result.message).toBe('null');
    });

    test('wraps undefined in an Error', () => {
        const result = convertToError(undefined);

        expect(result).toBeInstanceOf(Error);
        expect(result.message).toBe('undefined');
    });

    test('extracts message from objects with a message property', () => {
        const result = convertToError({ message: 'Internal Error', status: 500 });

        expect(result).toBeInstanceOf(Error);
        expect(result.message).toBe('Internal Error');
    });

    test('preserves stack from objects with a stack property', () => {
        const stack = 'Error: test\n    at load (+page.server.ts:10:15)';
        const result = convertToError({ message: 'test', stack });

        expect(result).toBeInstanceOf(Error);
        expect(result.message).toBe('test');
        expect(result.stack).toBe(stack);
    });

    test('preserves name from objects with a name property', () => {
        const result = convertToError({ message: 'test', name: 'TypeError' });

        expect(result).toBeInstanceOf(Error);
        expect(result.name).toBe('TypeError');
    });

    test('wraps an object without message in an Error', () => {
        const result = convertToError({ key: 'value' });

        expect(result).toBeInstanceOf(Error);
        expect(result.message).toBe('[object Object]');
    });

    test('wraps a boolean in an Error', () => {
        const result = convertToError(false);

        expect(result).toBeInstanceOf(Error);
        expect(result.message).toBe('false');
    });
});
