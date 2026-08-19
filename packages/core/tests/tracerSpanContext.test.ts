import { describe, expect, it, vi } from 'vitest';

import { Flare } from '../src/Flare';
import type { Attributes } from '../src/types';
import { FakeApi } from './helpers/FakeApi';

const setup = (collector: () => Attributes = () => ({})) => {
    const api = new FakeApi();
    const flare = new Flare(api, collector); // 2nd arg = contextCollector
    flare.light('test-key');
    flare.configure({ enableTracing: true, tracesSampleRate: 1 });
    return { api, flare };
};

describe('span context is captured at start, not end (no drift)', () => {
    it('a span does not pick up collector keys it never set, even if the collector changes before end', () => {
        const collector = vi.fn(() => ({ 'url.full': '/page-at-start', 'host.name': 'h' }));
        const { api, flare } = setup(collector);

        const span = flare.startSpan('op', { attributes: { 'flare.span_type': 'browser_navigation' } });
        collector.mockReturnValue({ 'url.full': '/navigated-away', 'host.name': 'h' });
        span.end();
        flare.flush();

        const body = JSON.stringify(api.traceEnvelopes);
        expect(body).toContain('browser_navigation');
        expect(body).not.toContain('/navigated-away');
        expect(body).not.toContain('/page-at-start');
        expect(body).toContain('host.name');
    });

    it('a root carries the scope as it was at START, not at end', () => {
        const { api, flare } = setup();
        flare.setUser({ id: 'user-at-start' });
        const root = flare.startSpan('op', {});
        flare.setUser({ id: 'user-after-navigating' });
        root.end();
        flare.flush();

        const body = JSON.stringify(api.traceEnvelopes);
        expect(body).toContain('user-at-start');
        expect(body).not.toContain('user-after-navigating');
    });

    it('a root inherits the assembled scope except user identity (user.id stays)', () => {
        const { api, flare } = setup();
        flare.setFramework({ name: 'React', version: '19.0.0' });
        flare.setUser({
            id: 'u1',
            email: 'shopper@example.com',
            fullName: 'Shopper Name',
            ipAddress: '203.0.113.9',
            plan: 'gold',
        });
        flare.addContext('cart', { total: 42 });
        flare.addContextGroup('checkout', { step: 'payment' });
        flare.startSpan('op', {}).end();
        flare.flush();

        const span = api.traceEnvelopes[0].resourceSpans[0].scopeSpans[0].spans[0];
        const keys = span.attributes.map((a) => a.key);

        // Included: opaque user id, and everything the trace viewer can usefully render.
        expect(keys).toContain('user.id');
        expect(keys).toContain('context.custom');
        expect(JSON.stringify(span)).toContain('framework');
        expect(JSON.stringify(span)).toContain('react');
        expect(keys).toContain('context.checkout');

        // Excluded: user identity fields, asserted individually so a partial regression cannot hide.
        expect(keys).not.toContain('user.email');
        expect(keys).not.toContain('user.full_name');
        expect(keys).not.toContain('client.address');
        expect(keys).not.toContain('user.attributes');
    });

    it('a continued-trace root (non-null parentSpanId) still carries start-time scope', () => {
        const { api, flare } = setup();
        flare.setUser({ id: 'user-at-start' });
        flare.tracer.continueFromTraceparent(`00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`);
        const root = flare.startSpan('op', {}); // local root of the continued trace, parentSpanId = remote span
        flare.setUser({ id: 'user-after-navigating' });
        root.end();
        flare.flush();

        const body = JSON.stringify(api.traceEnvelopes);
        expect(body).toContain('user-at-start');
        expect(body).not.toContain('user-after-navigating');
    });

    it('a child span gets no scope context (lean children)', () => {
        const { api, flare } = setup();
        flare.setUser({ id: 'user-at-start' });
        const root = flare.startSpan('root', {});
        const child = flare.startSpan('child', { parent: root, attributes: { 'http.request.method': 'GET' } });
        child.end();
        root.end();
        flare.flush();

        const spans = api.traceEnvelopes[0].resourceSpans[0].scopeSpans[0].spans;
        const childSpan = spans.find((s) => s.name === 'child');
        expect(JSON.stringify(childSpan)).toContain('http.request.method');
        expect(JSON.stringify(childSpan)).not.toContain('user.id');
        const rootSpan = spans.find((s) => s.name === 'root');
        expect(JSON.stringify(rootSpan)).toContain('user-at-start');
    });

    it('a late child of an ended root stays lean, it does not become a new local root', () => {
        const { api, flare } = setup();
        flare.setUser({ id: 'user-at-start' });
        const root = flare.startSpan('root', {});
        root.end(); // the trace state is pruned here
        flare.startSpan('late', { parent: root, attributes: { 'http.request.method': 'GET' } }).end();
        flare.flush();

        const spans = api.traceEnvelopes[0].resourceSpans[0].scopeSpans[0].spans;
        const lateSpan = spans.find((s) => s.name === 'late');
        expect(JSON.stringify(lateSpan)).toContain('http.request.method');
        expect(JSON.stringify(lateSpan)).not.toContain('user.id');
    });
});
