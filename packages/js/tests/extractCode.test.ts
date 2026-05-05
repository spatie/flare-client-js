import { describe, expect, test } from 'vitest';

import { extractCode } from '../src/util/extractCode';

describe('extractCode', () => {
    test('returns string code from error', () => {
        const err = Object.assign(new Error('boom'), { code: 'ENOTFOUND' });
        expect(extractCode(err)).toBe('ENOTFOUND');
    });

    test('returns undefined when no code', () => {
        expect(extractCode(new Error('boom'))).toBeUndefined();
    });

    test('returns undefined for non-string code (e.g. legacy Node errno number)', () => {
        const err = Object.assign(new Error('boom'), { code: 42 });
        expect(extractCode(err)).toBeUndefined();
    });

    test('returns undefined for empty string code', () => {
        const err = Object.assign(new Error('boom'), { code: '' });
        expect(extractCode(err)).toBeUndefined();
    });

    test('truncates code longer than 64 chars', () => {
        const long = 'A'.repeat(100);
        const err = Object.assign(new Error('boom'), { code: long });
        expect(extractCode(err)).toBe('A'.repeat(64));
    });
});
