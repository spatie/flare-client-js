import { DEFAULT_URL_DENYLIST, Flare, redactObjectValues, redactUrlQuery, resolveDenylist } from '@flareapp/core';
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import type { Attributes, Config } from '../src/types';
import { safeDecode } from '../src/util';
import { FakeApi } from './helpers/FakeApi';

describe('redactUrlQuery', () => {
    test('redacts denylisted query keys', () => {
        const result = redactUrlQuery('/page?token=abc&q=visible', DEFAULT_URL_DENYLIST);
        expect(result).toBe('/page?token=[redacted]&q=visible');
    });

    test('redacts session-style keys', () => {
        const result = redactUrlQuery('/page?session_id=xyz&tab=open', DEFAULT_URL_DENYLIST);
        expect(result).toBe('/page?session_id=[redacted]&tab=open');
    });

    test('preserves hash fragment after query', () => {
        const result = redactUrlQuery('/page?token=abc#section', DEFAULT_URL_DENYLIST);
        expect(result).toBe('/page?token=[redacted]#section');
    });

    test('handles hash-router URLs (query inside hash)', () => {
        const url = 'http://localhost/#/users/77?token=secret&tab=open';
        const result = redactUrlQuery(url, DEFAULT_URL_DENYLIST);
        expect(result).toBe('http://localhost/#/users/77?token=[redacted]&tab=open');
    });

    test('returns input unchanged when no query string present', () => {
        expect(redactUrlQuery('/page', DEFAULT_URL_DENYLIST)).toBe('/page');
        expect(redactUrlQuery('', DEFAULT_URL_DENYLIST)).toBe('');
    });

    test('honours a custom denylist', () => {
        const result = redactUrlQuery('/page?secretKey=xyz&token=visible', /^secretKey$/);
        expect(result).toBe('/page?secretKey=[redacted]&token=visible');
    });

    test('redacts keys without values', () => {
        expect(redactUrlQuery('/page?token', DEFAULT_URL_DENYLIST)).toBe('/page?token');
    });

    test('strips userinfo (user:pass@) from an absolute URL', () => {
        expect(redactUrlQuery('https://user:pass@host.test/path', DEFAULT_URL_DENYLIST)).toBe('https://host.test/path');
    });

    test('strips userinfo and still redacts denylisted query keys', () => {
        expect(redactUrlQuery('https://user:pass@host.test/path?token=abc&q=visible', DEFAULT_URL_DENYLIST)).toBe(
            'https://host.test/path?token=[redacted]&q=visible',
        );
    });

    test('strips userinfo when only a username is present', () => {
        expect(redactUrlQuery('https://user@host.test/', DEFAULT_URL_DENYLIST)).toBe('https://host.test/');
    });

    test('leaves an @ in the path or query untouched', () => {
        expect(redactUrlQuery('https://host.test/users/@handle?ref=a@b', DEFAULT_URL_DENYLIST)).toBe(
            'https://host.test/users/@handle?ref=a@b',
        );
    });
});

describe('redactObjectValues', () => {
    test('redacts values whose key matches the denylist', () => {
        const result = redactObjectValues({ token: 'abc', email: 'a@b.test' }, DEFAULT_URL_DENYLIST);
        expect(result).toEqual({ token: '[redacted]', email: 'a@b.test' });
    });

    test('passes non-denylisted values through unchanged, including non-strings', () => {
        const nested = { a: 1 };
        const result = redactObjectValues({ id: 42, config: nested }, DEFAULT_URL_DENYLIST);
        expect(result.id).toBe(42);
        expect(result.config).toBe(nested);
    });

    test('honours a custom denylist', () => {
        const result = redactObjectValues({ secretKey: 'x', token: 'kept' }, /^secretKey$/);
        expect(result).toEqual({ secretKey: '[redacted]', token: 'kept' });
    });

    test('stores a __proto__ key as an own property instead of dropping it', () => {
        const input: Record<string, unknown> = Object.create(null);
        input['__proto__'] = 'danger';

        const result = redactObjectValues(input, DEFAULT_URL_DENYLIST);

        expect(Object.prototype.hasOwnProperty.call(result, '__proto__')).toBe(true);
        expect(result['__proto__']).toBe('danger');
        expect(Object.getPrototypeOf(result)).toBeNull();
    });

    test('defaults to the built-in denylist', () => {
        expect(redactObjectValues({ password: 'x', page: '1' })).toEqual({ password: '[redacted]', page: '1' });
    });
});

describe('resolveDenylist', () => {
    test('returns default when no custom pattern given', () => {
        expect(resolveDenylist()).toBe(DEFAULT_URL_DENYLIST);
    });

    test('merges custom pattern with default', () => {
        const merged = resolveDenylist(/myParam/i);
        expect(merged.test('password')).toBe(true);
        expect(merged.test('myParam')).toBe(true);
    });

    test('replaces default when replaceDefault is true', () => {
        const replaced = resolveDenylist(/myParam/i, true);
        expect(replaced.test('password')).toBe(false);
        expect(replaced.test('myParam')).toBe(true);
    });

    test('strips global/sticky flags to prevent stateful .test()', () => {
        const resolved = resolveDenylist(/secret/gi, true);
        expect(resolved.flags).not.toContain('g');
        expect(resolved.flags).not.toContain('y');

        const url = '/page?secret=1&secret=2';
        const result = redactUrlQuery(url, resolved);
        expect(result).toBe('/page?secret=[redacted]&secret=[redacted]');
    });

    test('strips global/sticky flags when merging with default', () => {
        const resolved = resolveDenylist(/myParam/gy);
        expect(resolved.flags).not.toContain('g');
        expect(resolved.flags).not.toContain('y');
    });
});

function browserCollector(config: Readonly<Config>): Attributes {
    const attrs: Attributes = { 'flare.entry_point.type': 'web' };
    if (typeof window !== 'undefined' && window?.location?.href) {
        attrs['flare.entry_point.value'] = redactUrlQuery(window.location.href, config.urlDenylist);
        attrs['url.full'] = redactUrlQuery(window.location.href, config.urlDenylist);
        if (window.location.search) {
            attrs['url.query'] = redactUrlQuery(window.location.search, config.urlDenylist).replace(/^\?/, '');
        }
    }
    return attrs;
}

describe('Flare URL scrubbing', () => {
    let flare: Flare;
    let api: FakeApi;
    let originalHref: string;

    beforeEach(() => {
        originalHref = window.location.href;
        api = new FakeApi();
        flare = new Flare(api, browserCollector);
        flare.light('test-key', false);
    });

    afterEach(() => {
        window.history.replaceState({}, '', originalHref);
    });

    test('scrubs flare.entry_point.value, url.full, and url.query with default denylist', async () => {
        window.history.replaceState({}, '', '/page?token=secret&q=visible');

        await flare.report(new Error('boom'));

        const attributes = api.lastReport!.attributes;
        expect(attributes['flare.entry_point.value']).toContain('token=[redacted]');
        expect(attributes['flare.entry_point.value']).toContain('q=visible');
        expect(attributes['url.full']).toContain('token=[redacted]');
        expect(attributes['url.query']).toBe('token=[redacted]&q=visible');
    });

    test('merges custom urlDenylist with default', async () => {
        window.history.replaceState({}, '', '/page?secretKey=xyz&token=abc&q=visible');
        flare.configure({ urlDenylist: /^secretKey$/ });

        await flare.report(new Error('boom'));

        const attributes = api.lastReport!.attributes;
        expect(attributes['url.full']).toContain('secretKey=[redacted]');
        expect(attributes['url.full']).toContain('token=[redacted]');
        expect(attributes['url.full']).toContain('q=visible');
    });

    test('replaces default urlDenylist when replaceDefaultUrlDenylist is true', async () => {
        window.history.replaceState({}, '', '/page?secretKey=xyz&token=stillVisible');
        flare.configure({ urlDenylist: /^secretKey$/, replaceDefaultUrlDenylist: true });

        await flare.report(new Error('boom'));

        const attributes = api.lastReport!.attributes;
        expect(attributes['url.full']).toContain('secretKey=[redacted]');
        expect(attributes['url.full']).toContain('token=stillVisible');
    });

    test('preserves a custom urlDenylist across an unrelated reconfigure (regression B-core-1)', async () => {
        window.history.replaceState({}, '', '/page?secretKey=xyz&q=visible');
        flare.configure({ urlDenylist: /^secretKey$/ });

        // A later configure() that omits denylist config must NOT revert the custom denylist to the default,
        // which would silently stop redacting values the user asked to hide.
        flare.configure({ sampleRate: 1 });

        await flare.report(new Error('boom'));

        const attributes = api.lastReport!.attributes;
        expect(attributes['url.full']).toContain('secretKey=[redacted]');
        expect(attributes['url.full']).toContain('q=visible');
    });

    test('an unrelated configure() leaves the resolved urlDenylist reference untouched', () => {
        flare.configure({ urlDenylist: /^secretKey$/ });
        const before = flare.config.urlDenylist;

        flare.configure({ sampleRate: 0.5 });

        expect(flare.config.urlDenylist).toBe(before);
        expect(flare.config.urlDenylist.test('secretKey')).toBe(true);
        // The merged-in default entries survive too.
        expect(flare.config.urlDenylist.test('password')).toBe(true);
    });

    test('a later configure({ urlDenylist }) still updates the denylist after an unrelated reconfigure', async () => {
        window.history.replaceState({}, '', '/page?secretKey=xyz&token=abc&q=visible');
        flare.configure({ sampleRate: 1 });
        flare.configure({ urlDenylist: /^secretKey$/ });

        await flare.report(new Error('boom'));

        const attributes = api.lastReport!.attributes;
        expect(attributes['url.full']).toContain('secretKey=[redacted]');
        expect(attributes['url.full']).toContain('token=[redacted]');
        expect(attributes['url.full']).toContain('q=visible');
    });

    test('replaceDefaultUrlDenylist is still honored after an unrelated reconfigure', async () => {
        window.history.replaceState({}, '', '/page?secretKey=xyz&token=stillVisible');
        flare.configure({ sampleRate: 1 });
        flare.configure({ urlDenylist: /^secretKey$/, replaceDefaultUrlDenylist: true });

        await flare.report(new Error('boom'));

        const attributes = api.lastReport!.attributes;
        expect(attributes['url.full']).toContain('secretKey=[redacted]');
        expect(attributes['url.full']).toContain('token=stillVisible');
    });

    test('omits url.query when no query string', async () => {
        window.history.replaceState({}, '', '/page');

        await flare.report(new Error('boom'));

        const attributes = api.lastReport!.attributes;
        expect(attributes['url.full']).toBeDefined();
        expect(attributes['url.query']).toBeUndefined();
    });
});

describe('safeDecode', () => {
    test('decodes valid percent-escapes', () => {
        expect(safeDecode('a%20b')).toBe('a b');
    });

    test('falls back to the raw value on malformed escapes', () => {
        expect(safeDecode('%E0%A4%A')).toBe('%E0%A4%A');
    });
});
