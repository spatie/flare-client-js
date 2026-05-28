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

    it('projects user fields with OTel keys', () => {
        const provider = new AsyncLocalStorageScopeProvider();
        const collect = makeNodeContextCollector(provider, () => baseOpts);
        provider.runWithContext({}, () => {
            provider.setUser({ id: 'u1', email: 'a@b.c', ipAddress: '1.2.3.4' });
            const attrs = collect({ urlDenylist: DEFAULT_URL_DENYLIST } as any);
            expect(attrs['enduser.id']).toBe('u1');
            expect(attrs['enduser.email']).toBe('a@b.c');
            expect(attrs['client.address']).toBe('1.2.3.4');
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
});
