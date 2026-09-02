import { describe, expect, test } from 'vitest';

import { evictLruIfNew } from '../src/util';

describe('evictLruIfNew', () => {
    test('drops the oldest key once the cap is reached and the key is new', () => {
        const map = new Map([
            ['a', 1],
            ['b', 2],
        ]);

        evictLruIfNew(map, 'c', 2);

        expect([...map.keys()]).toEqual(['b']);
    });

    test('evicts nothing while the map is under the cap', () => {
        const map = new Map([['a', 1]]);

        evictLruIfNew(map, 'b', 2);

        expect([...map.keys()]).toEqual(['a']);
    });

    test('evicts nothing for a key already in the map', () => {
        const map = new Map([
            ['a', 1],
            ['b', 2],
        ]);

        evictLruIfNew(map, 'a', 2);

        expect([...map.keys()]).toEqual(['a', 'b']);
    });

    test('evicts nothing from an empty map', () => {
        const map = new Map<string, number>();

        expect(() => evictLruIfNew(map, 'a', 0)).not.toThrow();
        expect(map.size).toBe(0);
    });
});
