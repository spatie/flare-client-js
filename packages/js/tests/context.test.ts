// @vitest-environment jsdom
import { DEFAULT_URL_DENYLIST } from '@flareapp/core';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import cookie from '../src/browser/context/cookie';
import request from '../src/browser/context/request';
import requestData from '../src/browser/context/requestData';

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
    expect(attributes['user_agent.original']).toBe('TestAgent/1.0');
    expect(attributes['http.request.referrer']).toBe('https://example.com/from');
    expect(attributes['document.ready_state']).toBe('complete');
});

test('emits url.query as raw query string without leading ?', () => {
    const attributes = requestData(DEFAULT_URL_DENYLIST);

    expect(attributes['url.query']).toBe('utm=foo&q=bar');
});

test('omits url.query when no search string is present', () => {
    setLocation('https://app.test/some/path');

    const attributes = requestData(DEFAULT_URL_DENYLIST);

    expect('url.query' in attributes).toBe(false);
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
    // Feed a raw cookie string directly: jsdom's cookie jar would otherwise reject/normalize the name.
    // The accessor is defined on Document.prototype, so an own-property override on the instance
    // shadows it; deleting that override restores the original getter.
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
