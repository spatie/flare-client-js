import { expect, test } from 'vitest';

import { flatJsonStringify } from '../src/util/flatJsonStringify';

test('replaces direct cycle with [Circular]', () => {
    const a: any = { name: 'a' };
    a.self = a;

    const result = flatJsonStringify(a);

    expect(result).toContain('"self":"[Circular]"');
});

test('does not flag shared (non-cyclic) sub-object as circular', () => {
    const shared = { id: 7 };
    const root = { left: shared, right: shared };

    const result = flatJsonStringify(root);
    const parsed = JSON.parse(result);

    expect(parsed.left).toEqual({ id: 7 });
    expect(parsed.right).toEqual({ id: 7 });
});

test('handles deeply nested cycles without throwing', () => {
    const a: any = { name: 'a' };
    const b: any = { name: 'b' };
    const c: any = { name: 'c' };
    a.next = b;
    b.next = c;
    c.next = a;

    expect(() => flatJsonStringify(a)).not.toThrow();
    const result = flatJsonStringify(a);
    expect(result).toContain('"[Circular]"');
});

test('passes through primitives unchanged', () => {
    expect(flatJsonStringify({ s: 'hi', n: 1, b: true, x: null })).toBe(
        JSON.stringify({ s: 'hi', n: 1, b: true, x: null })
    );
});
