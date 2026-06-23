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
        expect(attrs['flare.entry_point.type']).toBe('server');
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

    it('projects request.url through redactUrlQuery into url.full', () => {
        const provider = new AsyncLocalStorageScopeProvider();
        const collect = makeNodeContextCollector(provider, () => baseOpts);
        provider.runWithContext({ url: 'https://x.test/a?password=hunter2' }, () => {
            const attrs = collect({ urlDenylist: DEFAULT_URL_DENYLIST } as any);
            expect(attrs['url.full']).toBe('https://x.test/a?password=[redacted]');
        });
    });

    it('projects user fields to user.* and client.address', () => {
        const provider = new AsyncLocalStorageScopeProvider();
        const collect = makeNodeContextCollector(provider, () => baseOpts);
        provider.runWithContext({}, () => {
            const scope = provider.active();
            scope.setAttribute('user.id', 'u1');
            scope.setAttribute('user.email', 'a@b.c');
            scope.setAttribute('client.address', '1.2.3.4');
            const attrs = collect({ urlDenylist: DEFAULT_URL_DENYLIST } as any);
            expect(attrs['user.id']).toBe('u1');
            expect(attrs['user.email']).toBe('a@b.c');
            expect(attrs['client.address']).toBe('1.2.3.4');
            expect(attrs['enduser.id']).toBeUndefined();
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
