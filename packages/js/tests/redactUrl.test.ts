// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { Flare } from '../src/Flare';
import { DEFAULT_URL_DENYLIST, redactFullPath } from '../src/util';

import { FakeApi } from './helpers/FakeApi';

describe('redactFullPath', () => {
    test('redacts denylisted query keys', () => {
        const result = redactFullPath('/page?token=abc&q=visible', DEFAULT_URL_DENYLIST);
        expect(result).toBe('/page?token=[redacted]&q=visible');
    });

    test('redacts session-style keys', () => {
        const result = redactFullPath('/page?session_id=xyz&tab=open', DEFAULT_URL_DENYLIST);
        expect(result).toBe('/page?session_id=[redacted]&tab=open');
    });

    test('preserves hash fragment after query', () => {
        const result = redactFullPath('/page?token=abc#section', DEFAULT_URL_DENYLIST);
        expect(result).toBe('/page?token=[redacted]#section');
    });

    test('handles hash-router URLs (query inside hash)', () => {
        const url = 'http://localhost/#/users/77?token=secret&tab=open';
        const result = redactFullPath(url, DEFAULT_URL_DENYLIST);
        expect(result).toBe('http://localhost/#/users/77?token=[redacted]&tab=open');
    });

    test('returns input unchanged when no query string present', () => {
        expect(redactFullPath('/page', DEFAULT_URL_DENYLIST)).toBe('/page');
        expect(redactFullPath('', DEFAULT_URL_DENYLIST)).toBe('');
    });

    test('honours a custom denylist', () => {
        const result = redactFullPath('/page?secretKey=xyz&token=visible', /^secretKey$/);
        expect(result).toBe('/page?secretKey=[redacted]&token=visible');
    });

    test('redacts keys without values', () => {
        expect(redactFullPath('/page?token', DEFAULT_URL_DENYLIST)).toBe('/page?token');
    });
});

describe('Flare URL scrubbing', () => {
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

    test('honours configured custom urlDenylist', async () => {
        window.history.replaceState({}, '', '/page?secretKey=xyz&token=stillVisible');
        flare.configure({ urlDenylist: /^secretKey$/ });

        await flare.report(new Error('boom'));

        const attributes = api.lastReport!.attributes;
        expect(attributes['url.full']).toContain('secretKey=[redacted]');
        expect(attributes['url.full']).toContain('token=stillVisible');
        expect(attributes['url.query']).toBe('secretKey=[redacted]&token=stillVisible');
    });

    test('omits url.query when no query string', async () => {
        window.history.replaceState({}, '', '/page');

        await flare.report(new Error('boom'));

        const attributes = api.lastReport!.attributes;
        expect(attributes['url.full']).toBeDefined();
        expect(attributes['url.query']).toBeUndefined();
    });
});
