// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { collectAttributes } from '../src/context';

const originalLocation = Object.getOwnPropertyDescriptor(window, 'location');
const originalReferrer = Object.getOwnPropertyDescriptor(Document.prototype, 'referrer');

function setLocation(url: string) {
    Object.defineProperty(window, 'location', { configurable: true, value: new URL(url) });
}

function clearCookies() {
    for (const cookie of window.document.cookie.split('; ')) {
        const name = cookie.split('=')[0];
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
    const attributes = collectAttributes();

    expect(attributes['url.full']).toBe('https://app.test/some/path?utm=foo&q=bar');
    expect(attributes['user_agent.original']).toBe('TestAgent/1.0');
    expect(attributes['http.request.referrer']).toBe('https://example.com/from');
    expect(attributes['document.ready_state']).toBe('complete');
});

test('emits url.query as raw query string without leading ?', () => {
    const attributes = collectAttributes();

    expect(attributes['url.query']).toBe('utm=foo&q=bar');
});

test('omits url.query when no search string is present', () => {
    setLocation('https://app.test/some/path');

    const attributes = collectAttributes();

    expect('url.query' in attributes).toBe(false);
});

test('emits http.request.cookies as parsed object', () => {
    const attributes = collectAttributes();

    expect(attributes['http.request.cookies']).toEqual({
        session: 'abc',
        theme: 'dark',
    });
});

test('returns empty object when no window present (SSR)', () => {
    const realWindow = globalThis.window;
    // @ts-expect-error
    delete globalThis.window;

    expect(collectAttributes()).toEqual({});

    globalThis.window = realWindow;
});
