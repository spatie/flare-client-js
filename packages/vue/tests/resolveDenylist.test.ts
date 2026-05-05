import { describe, expect, test } from 'vitest';

import { DEFAULT_PROPS_DENYLIST, resolveDenylist } from '../src/constants';

describe('resolveDenylist', () => {
    test('returns the default when no custom RegExp is given', () => {
        expect(resolveDenylist()).toBe(DEFAULT_PROPS_DENYLIST);
    });

    test('returns the default when custom is undefined', () => {
        expect(resolveDenylist(undefined)).toBe(DEFAULT_PROPS_DENYLIST);
    });

    test('merges custom RegExp with the default by default', () => {
        const merged = resolveDenylist(/^ssn$/);

        expect(merged.test('ssn')).toBe(true);
        expect(merged.test('password')).toBe(true);
        expect(merged.test('token')).toBe(true);
        expect(merged.test('id')).toBe(false);
    });

    test('replaces the default when replaceDefault is true', () => {
        const replaced = resolveDenylist(/^ssn$/, true);

        expect(replaced.test('ssn')).toBe(true);
        expect(replaced.test('password')).toBe(false);
        expect(replaced.test('token')).toBe(false);
    });

    test('preserves case-insensitive matching across both patterns when merged', () => {
        const merged = resolveDenylist(/^extraSecret$/);

        expect(merged.test('extrasecret')).toBe(true);
        expect(merged.test('PASSWORD')).toBe(true);
    });

    test('strips global flag from merged result so .test() is stateless', () => {
        const merged = resolveDenylist(/^ssn$/g);

        expect(merged.test('ssn')).toBe(true);
        expect(merged.test('ssn')).toBe(true);
    });
});
