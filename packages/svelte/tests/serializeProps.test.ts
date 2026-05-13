import { describe, expect, test } from 'vitest';

import { MAX_PROP_ARRAY_LENGTH, MAX_PROP_OBJECT_KEYS } from '../src/constants';
import { serializeProps } from '../src/serializeProps';

describe('serializeProps', () => {
    test('serializes primitive values', () => {
        const result = serializeProps({ name: 'Alice', age: 30, active: true, score: null }, 2);
        expect(result).toEqual({ name: 'Alice', age: 30, active: true, score: null });
    });

    test('serializes undefined as [undefined]', () => {
        const result = serializeProps({ value: undefined }, 2);
        expect(result).toEqual({ value: '[undefined]' });
    });

    test('serializes functions as [Function]', () => {
        const result = serializeProps({ onClick: () => {} }, 2);
        expect(result).toEqual({ onClick: '[Function]' });
    });

    test('serializes symbols as [Symbol]', () => {
        const result = serializeProps({ id: Symbol('test') }, 2);
        expect(result).toEqual({ id: '[Symbol]' });
    });

    test('serializes bigint as string', () => {
        const result = serializeProps({ big: BigInt(42) }, 2);
        expect(result).toEqual({ big: '42' });
    });

    test('truncates long strings', () => {
        const longString = 'a'.repeat(1500);
        const result = serializeProps({ text: longString }, 2);
        const serialized = result.text as string;
        expect(serialized.length).toBeLessThan(longString.length);
        expect(serialized).toContain('truncated');
    });

    test('respects max depth for nested objects', () => {
        const result = serializeProps({ nested: { deep: { deeper: 'value' } } }, 1);
        expect(result).toEqual({ nested: { deep: '[Object]' } });
    });

    test('respects max depth for nested arrays', () => {
        const result = serializeProps({ items: [['nested']] }, 1);
        expect(result).toEqual({ items: ['[Array]'] });
    });

    test('detects circular references', () => {
        const obj: Record<string, unknown> = { a: 1 };
        obj.self = obj;
        const result = serializeProps(obj, 2);
        expect(result).toEqual({ a: 1, self: '[Circular]' });
    });

    test('redacts keys matching denylist', () => {
        const result = serializeProps({ username: 'alice', password: 'secret123', token: 'abc' }, 2);
        expect(result).toEqual({
            username: 'alice',
            password: '[redacted]',
            token: '[redacted]',
        });
    });

    test('accepts custom denylist', () => {
        const customDenylist = /^secret_/i;
        const result = serializeProps({ secret_key: 'value', password: 'pass', normal: 'ok' }, 2, customDenylist);
        expect(result.secret_key).toBe('[redacted]');
        expect(result.password).toBe('pass');
        expect(result.normal).toBe('ok');
    });

    test('limits array length', () => {
        const largeArray = Array.from({ length: 150 }, (_, i) => i);
        const result = serializeProps({ items: largeArray }, 2);
        const items = result.items as unknown[];
        expect(items.length).toBe(MAX_PROP_ARRAY_LENGTH + 1);
        expect(items[items.length - 1]).toContain('more items');
    });

    test('limits object keys', () => {
        const largeObj: Record<string, number> = {};
        for (let i = 0; i < 150; i++) {
            largeObj[`key${i}`] = i;
        }
        const result = serializeProps(largeObj, 2);
        const keys = Object.keys(result);
        expect(keys.length).toBe(MAX_PROP_OBJECT_KEYS + 1);
        expect(result['…']).toContain('more keys');
    });

    test('handles class instances as [Object]', () => {
        const result = serializeProps({ date: new Date(), map: new Map() }, 2);
        expect(result).toEqual({ date: '[Object]', map: '[Object]' });
    });

    test('walks through proxy objects wrapping plain objects', () => {
        const proxy = new Proxy({ count: 5 }, {});
        const result = serializeProps({ state: proxy }, 2);
        expect(result).toEqual({ state: { count: 5 } });
    });
});
