import { describe, expect, it } from 'vitest';

import { DEFAULT_HEADER_DENYLIST, projectHeaders } from '../src/context/headers';

describe('projectHeaders', () => {
    it('emits each header as http.request.header.<lowercase-name>', () => {
        const attrs = projectHeaders(
            { 'Content-Type': 'application/json', 'X-Foo': 'bar' },
            {
                headerDenylist: DEFAULT_HEADER_DENYLIST,
                headerAllowlist: null,
            },
        );
        expect(attrs['http.request.header.content-type']).toBe('application/json');
        expect(attrs['http.request.header.x-foo']).toBe('bar');
    });

    it('redacts default-denylisted headers', () => {
        const attrs = projectHeaders(
            { Authorization: 'Bearer xyz', Cookie: 'sid=1' },
            {
                headerDenylist: DEFAULT_HEADER_DENYLIST,
                headerAllowlist: null,
            },
        );
        expect(attrs['http.request.header.authorization']).toBe('[redacted]');
        expect(attrs['http.request.header.cookie']).toBe('[redacted]');
    });

    it('allowlist filters out non-allowed headers entirely', () => {
        const attrs = projectHeaders(
            { 'X-Foo': 'bar', 'X-Baz': 'qux' },
            {
                headerDenylist: DEFAULT_HEADER_DENYLIST,
                headerAllowlist: /^x-foo$/i,
            },
        );
        expect(attrs['http.request.header.x-foo']).toBe('bar');
        expect(attrs['http.request.header.x-baz']).toBeUndefined();
    });

    it('coalesces array values', () => {
        const attrs = projectHeaders(
            { 'X-Foo': ['a', 'b'] as any },
            {
                headerDenylist: DEFAULT_HEADER_DENYLIST,
                headerAllowlist: null,
            },
        );
        expect(attrs['http.request.header.x-foo']).toBe('a, b');
    });
});
