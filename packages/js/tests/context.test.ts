// @vitest-environment jsdom
import { DEFAULT_URL_DENYLIST } from '@flareapp/core';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import cookie from '../src/browser/context/cookie';
import request from '../src/browser/context/request';

const originalLocation = Object.getOwnPropertyDescriptor(window, 'location');
const originalReferrer = Object.getOwnPropertyDescriptor(Document.prototype, 'referrer');

function setLocation(url: string) {
    Object.defineProperty(window, 'location', { configurable: true, value: new URL(url) });
}

function clearCookies() {
    for (const c of window.document.cookie.split('; ')) {
        const name = c.split('=')[0];
        if (name) {
            (window.document as any).cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
        }
    }
}

beforeEach(() => {
    vi.stubGlobal('navigator', { userAgent: 'TestAgent/1.0' });
    Object.defineProperty(window.document, 'referrer', {
        configurable: true,
        get: () => 'https://example.com/from',
    });
    Object.defineProperty(window.document, 'readyState', {
        configurable: true,
        get: () => 'complete',
    });

    setLocation('https://app.test/some/path?utm=foo&q=bar');
    clearCookies();
    (window.document as any).cookie = 'session=abc';
    (window.document as any).cookie = 'theme=dark';
});

afterEach(() => {
    if (originalLocation) {
        Object.defineProperty(window, 'location', originalLocation);
    }
    if (originalReferrer) {
        Object.defineProperty(Document.prototype, 'referrer', originalReferrer);
    }
    clearCookies();
    vi.unstubAllGlobals();
});

test('emits flat OTel-style request attributes', () => {
    const attributes = request(DEFAULT_URL_DENYLIST);

    expect(attributes['url.full']).toBe('https://app.test/some/path?utm=foo&q=bar');
    expect(attributes['url.scheme']).toBe('https');
    expect(attributes['url.path']).toBe('/some/path');
    expect(attributes['url.query']).toBe('utm=foo&q=bar');
    expect(attributes['user_agent.original']).toBe('TestAgent/1.0');
    expect(attributes['http.request.referrer']).toBe('https://example.com/from');
    expect(attributes['document.ready_state']).toBe('complete');
});

test('omits url.query when no search string is present', () => {
    setLocation('https://app.test/some/path');

    const attributes = request(DEFAULT_URL_DENYLIST);

    expect('url.query' in attributes).toBe(false);
});

test('redacts denylisted query values across url.full and url.query', () => {
    setLocation('https://app.test/reset?token=abc123&q=bar');

    const attributes = request(DEFAULT_URL_DENYLIST);

    expect(attributes['url.full']).toBe('https://app.test/reset?token=[redacted]&q=bar');
    expect(attributes['url.query']).toBe('token=[redacted]&q=bar');
});

test('derives the url.* set from an href override instead of the live location', () => {
    const attributes = request(DEFAULT_URL_DENYLIST, 'https://app.test/product/p01?size=l');

    expect(attributes['url.full']).toBe('https://app.test/product/p01?size=l');
    expect(attributes['url.path']).toBe('/product/p01');
    expect(attributes['url.query']).toBe('size=l');
});

test('emits http.request.cookies as parsed object, redacting denylisted names', () => {
    const attributes = cookie(DEFAULT_URL_DENYLIST);

    // `session` matches the denylist, `theme` does not.
    expect(attributes['http.request.cookies']).toEqual({
        session: '[redacted]',
        theme: 'dark',
    });
});

test('redacts every cookie whose name matches the denylist', () => {
    clearCookies();
    (window.document as any).cookie = 'token=jwt-value';
    (window.document as any).cookie = 'csrf=csrf-value';
    (window.document as any).cookie = 'theme=dark';

    const cookies = cookie(DEFAULT_URL_DENYLIST)['http.request.cookies'] as Record<string, string>;

    expect(cookies.token).toBe('[redacted]');
    expect(cookies.csrf).toBe('[redacted]');
    expect(cookies.theme).toBe('dark');
});

test('preserves = characters inside non-denylisted cookie values (e.g. base64)', () => {
    clearCookies();
    (window.document as any).cookie = 'data=abc==';

    const attributes = cookie(DEFAULT_URL_DENYLIST);

    expect((attributes['http.request.cookies'] as Record<string, string>).data).toBe('abc==');
});

test('stores a cookie literally named __proto__ instead of dropping it', () => {
    // Feeds a raw cookie string, since jsdom's cookie jar would reject or normalize this name. The
    // accessor lives on Document.prototype; an own-property override here shadows it until deleted.
    Object.defineProperty(window.document, 'cookie', {
        configurable: true,
        get: () => '__proto__=danger; theme=dark',
    });

    try {
        const cookies = cookie(DEFAULT_URL_DENYLIST)['http.request.cookies'] as Record<string, string>;

        expect(Object.prototype.hasOwnProperty.call(cookies, '__proto__')).toBe(true);
        expect(cookies['__proto__']).toBe('danger');
        expect(cookies.theme).toBe('dark');
    } finally {
        delete (window.document as any).cookie;
    }
});
