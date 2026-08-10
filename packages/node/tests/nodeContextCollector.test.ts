import { DEFAULT_URL_DENYLIST } from '@flareapp/core';
import { describe, expect, it } from 'vitest';

import { DEFAULT_BODY_CONTENT_TYPES, DEFAULT_BODY_KEY_DENYLIST } from '../src/context/body';
import { makeNodeContextCollector } from '../src/context/collectNode';
import { DEFAULT_HEADER_DENYLIST } from '../src/context/headers';
import { AsyncLocalStorageScopeProvider } from '../src/scope/AsyncLocalStorageScopeProvider';

const baseOpts = {
    headerDenylist: DEFAULT_HEADER_DENYLIST,
    headerAllowlist: null,
    captureRequestBody: false,
    bodyAllowedContentTypes: DEFAULT_BODY_CONTENT_TYPES,
    bodyKeyDenylist: DEFAULT_BODY_KEY_DENYLIST,
    bodyMaxBytes: 16_384,
};

describe('Node ContextCollector', () => {
    it('emits process attributes when called outside a scope', () => {
        const provider = new AsyncLocalStorageScopeProvider();
        const collect = makeNodeContextCollector(provider, () => baseOpts);
        const attrs = collect({ urlDenylist: DEFAULT_URL_DENYLIST } as any);
        expect(attrs['process.runtime.name']).toBe('nodejs');
        expect(attrs['flare.entry_point.type']).toBe('web');
    });

    it('projects request.path into url.path + url.query', () => {
        const provider = new AsyncLocalStorageScopeProvider();
        const collect = makeNodeContextCollector(provider, () => baseOpts);
        provider.runWithContext({ method: 'POST', path: '/foo?bar=1&token=x' }, () => {
            const attrs = collect({ urlDenylist: DEFAULT_URL_DENYLIST } as any);
            expect(attrs['http.request.method']).toBe('POST');
            expect(attrs['url.path']).toBe('/foo');
            expect(attrs['url.query']).toBe('bar=1&token=[redacted]');
        });
    });

    it('projects request.url into redacted url.full + url.scheme', () => {
        const provider = new AsyncLocalStorageScopeProvider();
        const collect = makeNodeContextCollector(provider, () => baseOpts);
        provider.runWithContext({ url: 'https://x.test/a?password=hunter2' }, () => {
            const attrs = collect({ urlDenylist: DEFAULT_URL_DENYLIST } as any);
            expect(attrs['url.full']).toBe('https://x.test/a?password=[redacted]');
            expect(attrs['url.scheme']).toBe('https');
        });
    });

    it('lets request.path own url.path and url.query even when request.url is also set', () => {
        const provider = new AsyncLocalStorageScopeProvider();
        const collect = makeNodeContextCollector(provider, () => baseOpts);
        // The absolute url and the routed path can disagree. The routed path wins.
        provider.runWithContext({ path: '/foo?bar=1', url: 'https://x.test/prefix/foo?bar=1' }, () => {
            const attrs = collect({ urlDenylist: DEFAULT_URL_DENYLIST } as any);
            expect(attrs['url.path']).toBe('/foo');
            expect(attrs['url.query']).toBe('bar=1');
            expect(attrs['url.scheme']).toBe('https');
        });
    });

    it('omits url.scheme when request.url is not absolute', () => {
        const provider = new AsyncLocalStorageScopeProvider();
        const collect = makeNodeContextCollector(provider, () => baseOpts);
        provider.runWithContext({ url: '/relative/a' }, () => {
            const attrs = collect({ urlDenylist: DEFAULT_URL_DENYLIST } as any);
            expect(attrs['url.full']).toBe('/relative/a');
            expect('url.scheme' in attrs).toBe(false);
        });
    });

    it('does not emit enduser.* keys (identity now flows via pendingAttributes)', () => {
        const provider = new AsyncLocalStorageScopeProvider();
        const collect = makeNodeContextCollector(provider, () => baseOpts);
        provider.runWithContext({}, () => {
            const scope = provider.active();
            scope.setAttribute('user.id', 'u1');
            scope.setAttribute('client.address', '1.2.3.4');
            const attrs = collect({ urlDenylist: DEFAULT_URL_DENYLIST } as any);
            expect(attrs['enduser.id']).toBeUndefined();
            expect(attrs['enduser.email']).toBeUndefined();
            expect(attrs['enduser.username']).toBeUndefined();
            expect(attrs['user.id']).toBeUndefined();
            expect(attrs['client.address']).toBeUndefined();
        });
    });

    it('respects captureRequestBody=false', () => {
        const provider = new AsyncLocalStorageScopeProvider();
        const collect = makeNodeContextCollector(provider, () => baseOpts);
        provider.runWithContext({ body: { a: 1 }, headers: { 'content-type': 'application/json' } }, () => {
            const attrs = collect({ urlDenylist: DEFAULT_URL_DENYLIST } as any);
            expect(attrs['http.request.body']).toBeUndefined();
        });
    });

    it('captures body when enabled', () => {
        const provider = new AsyncLocalStorageScopeProvider();
        const collect = makeNodeContextCollector(provider, () => ({ ...baseOpts, captureRequestBody: true }));
        provider.runWithContext({ body: { a: 1 }, headers: { 'content-type': 'application/json' } }, () => {
            const attrs = collect({ urlDenylist: DEFAULT_URL_DENYLIST } as any);
            expect(attrs['http.request.body']).toBe('{"a":1}');
        });
    });

    it('captures body with CONTENT-TYPE header casing', () => {
        const provider = new AsyncLocalStorageScopeProvider();
        const collect = makeNodeContextCollector(provider, () => ({ ...baseOpts, captureRequestBody: true }));
        provider.runWithContext({ body: { a: 1 }, headers: { 'CONTENT-TYPE': 'application/json' } }, () => {
            const attrs = collect({ urlDenylist: DEFAULT_URL_DENYLIST } as any);
            expect(attrs['http.request.body']).toBe('{"a":1}');
        });
    });

    it('captures body with Content-type header casing', () => {
        const provider = new AsyncLocalStorageScopeProvider();
        const collect = makeNodeContextCollector(provider, () => ({ ...baseOpts, captureRequestBody: true }));
        provider.runWithContext(
            { body: '{"a":1}', headers: { 'Content-type': 'application/json; charset=utf-8' } },
            () => {
                const attrs = collect({ urlDenylist: DEFAULT_URL_DENYLIST } as any);
                expect(attrs['http.request.body']).toBe('{"a":1}');
            },
        );
    });

    it('captures body when content-type is an array value (uses first element)', () => {
        const provider = new AsyncLocalStorageScopeProvider();
        const collect = makeNodeContextCollector(provider, () => ({ ...baseOpts, captureRequestBody: true }));
        provider.runWithContext({ body: { a: 1 }, headers: { 'content-type': ['application/json'] as any } }, () => {
            const attrs = collect({ urlDenylist: DEFAULT_URL_DENYLIST } as any);
            expect(attrs['http.request.body']).toBe('{"a":1}');
        });
    });
});
