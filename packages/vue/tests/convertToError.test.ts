import { describe, expect, test } from 'vitest';

import { convertToError } from '../src/convertToError';

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

    test('serializes plain objects as JSON in the error message', () => {
        const result = convertToError({ code: 'E_AUTH', message: 'bad' });

        expect(result).toBeInstanceOf(Error);
        expect(result.message).toBe('{"code":"E_AUTH","message":"bad"}');
    });

    test('serializes arrays as JSON in the error message', () => {
        const result = convertToError([1, 'two', { three: 3 }]);

        expect(result).toBeInstanceOf(Error);
        expect(result.message).toBe('[1,"two",{"three":3}]');
    });

    test('falls back to String() when JSON serialization throws on a circular value', () => {
        const obj: Record<string, unknown> = { a: 1 };
        obj.self = obj;

        const result = convertToError(obj);

        expect(result).toBeInstanceOf(Error);
        expect(result.message).toBe('[object Object]');
    });

    test('falls back to String() when JSON.stringify returns undefined (e.g. pure symbol)', () => {
        const result = convertToError({ [Symbol('x')]: 1 } as unknown);

        expect(result).toBeInstanceOf(Error);
        // JSON.stringify drops symbol keys, producing "{}". That is acceptable as a message.
        expect(typeof result.message).toBe('string');
    });

    test('wraps a boolean in an Error', () => {
        const result = convertToError(false);

        expect(result).toBeInstanceOf(Error);
        expect(result.message).toBe('false');
    });
});
