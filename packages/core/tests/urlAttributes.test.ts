import { describe, expect, it } from 'vitest';

import { urlAttributes } from '../src/util/urlAttributes';

describe('urlAttributes', () => {
    it('splits an absolute url into the OTel url.* set', () => {
        expect(urlAttributes('https://shop.test/product/p01?size=l&color=red')).toEqual({
            'url.full': 'https://shop.test/product/p01?size=l&color=red',
            'url.scheme': 'https',
            'url.path': '/product/p01',
            'url.query': 'size=l&color=red',
        });
    });

    it('leaves url.query out when there is no query string', () => {
        const attrs = urlAttributes('https://shop.test/cart');

        expect(attrs).toEqual({
            'url.full': 'https://shop.test/cart',
            'url.scheme': 'https',
            'url.path': '/cart',
        });
        expect('url.query' in attrs).toBe(false);
    });

    it('leaves url.query out for a bare question mark', () => {
        expect('url.query' in urlAttributes('https://shop.test/cart?')).toBe(false);
    });

    it('redacts denylisted query values in both url.full and url.query', () => {
        const attrs = urlAttributes('https://shop.test/reset?token=abc123&name=dries');

        expect(attrs['url.full']).toBe('https://shop.test/reset?token=[redacted]&name=dries');
        expect(attrs['url.query']).toBe('token=[redacted]&name=dries');
    });

    it('honours a custom denylist', () => {
        const attrs = urlAttributes('https://shop.test/x?order_id=9&token=abc', /order_id/i);

        expect(attrs['url.query']).toBe('order_id=[redacted]&token=abc');
    });

    it('strips userinfo from url.full', () => {
        const attrs = urlAttributes('https://dries:hunter2@shop.test/account');

        expect(attrs['url.full']).toBe('https://shop.test/account');
        expect(attrs['url.path']).toBe('/account');
    });

    it('leaves path segments alone even when they look denylisted', () => {
        expect(urlAttributes('https://shop.test/token/abc123')['url.path']).toBe('/token/abc123');
    });

    it('keeps the fragment on url.full but out of path and query', () => {
        const attrs = urlAttributes('https://shop.test/faq?q=1#shipping');

        expect(attrs['url.full']).toBe('https://shop.test/faq?q=1#shipping');
        expect(attrs['url.path']).toBe('/faq');
        expect(attrs['url.query']).toBe('q=1');
    });

    it('returns url.full alone for a url that will not parse', () => {
        expect(urlAttributes('/relative/path?token=abc')).toEqual({
            'url.full': '/relative/path?token=[redacted]',
        });
    });

    it('reports non-http schemes', () => {
        const attrs = urlAttributes('file:///Users/dries/app/index.html');

        expect(attrs['url.scheme']).toBe('file');
        expect(attrs['url.path']).toBe('/Users/dries/app/index.html');
    });
});
