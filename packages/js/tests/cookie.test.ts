// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';

import cookie from '../src/context/cookie';

afterEach(() => {
    document.cookie.split(';').forEach((c) => {
        const name = c.split('=')[0].trim();
        if (name) {
            document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
        }
    });
});

test('preserves = inside cookie values', () => {
    document.cookie = 'session=YWJjZGVm==; path=/';

    const result = cookie();

    expect(result.cookies?.session).toBe('YWJjZGVm==');
});

test('skips cookies without =', () => {
    document.cookie = 'noequals; path=/';

    const result = cookie();

    expect(result.cookies?.noequals).toBeUndefined();
});

test('returns empty object when no cookies present', () => {
    expect(cookie()).toEqual({});
});
