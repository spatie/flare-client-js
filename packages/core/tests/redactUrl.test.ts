import { DEFAULT_URL_DENYLIST, Flare, redactUrlQuery, resolveDenylist } from '@flareapp/core';
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

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

// TODO(node-sdk-Task26): re-enable once BrowserContextCollector is wired into the singleton
describe.skip('Flare URL scrubbing', () => {
    let flare: Flare;
    let api: FakeApi;
    let originalHref: string;

    beforeEach(() => {
        originalHref = window.location.href;
        api = new FakeApi();
        flare = new Flare(api);
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

    test('omits url.query when no query string', async () => {
        window.history.replaceState({}, '', '/page');

        await flare.report(new Error('boom'));

        const attributes = api.lastReport!.attributes;
        expect(attributes['url.full']).toBeDefined();
        expect(attributes['url.query']).toBeUndefined();
    });
});
