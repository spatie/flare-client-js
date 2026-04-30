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

test('parses a simple cookie', () => {
    document.cookie = 'simple=value; path=/';

    const result = cookie();

    expect(result.cookies?.simple).toBe('value');
});

test('preserves = inside cookie values', () => {
    document.cookie = 'session=YWJjZGVm==; path=/';

    const result = cookie();

    expect(result.cookies?.session).toBe('YWJjZGVm==');
});

test('skips cookies without = while keeping valid ones', () => {
    document.cookie = 'good=1; path=/';
    document.cookie = 'noequals; path=/';

    const result = cookie();

    expect(result.cookies).toEqual({ good: '1' });
});

test('returns empty object when no cookies present', () => {
    expect(cookie()).toEqual({});
});
