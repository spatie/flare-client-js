import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { buildTracesEnvelope } from '../src/tracing/envelope';
import type { BufferedSpan } from '../src/types';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/traces-envelope.json', import.meta.url), 'utf8'));

const span = (over: Partial<BufferedSpan> = {}): BufferedSpan => ({
    traceId: 'a'.repeat(32),
    spanId: 'b'.repeat(16),
    parentSpanId: null,
    name: 'op',
    startTimeUnixNano: 1,
    endTimeUnixNano: 2,
    status: { code: 0 },
    recordAttributes: [],
    resourceAttributes: {},
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    events: [],
    ...over,
});

describe('buildTracesEnvelope', () => {
    it('emits parentSpanId: null for a root span (key present, not omitted)', () => {
        const env = buildTracesEnvelope([span()], {}, '@flareapp/core', '1.0.0');
        const out = env.resourceSpans[0].scopeSpans[0].spans[0];
        expect('parentSpanId' in out).toBe(true);
        expect(out.parentSpanId).toBeNull();
        expect(out.links).toEqual([]);
        expect(out.droppedLinksCount).toBe(0);
    });

    it('passes through a child parentSpanId and per-event dropped counts', () => {
        const env = buildTracesEnvelope(
            [
                span({
                    parentSpanId: 'c'.repeat(16),
                    events: [{ name: 'e', timeUnixNano: 5, attributes: [], droppedAttributesCount: 2 }],
                    droppedAttributesCount: 1,
                    droppedEventsCount: 3,
                }),
            ],
            {},
            '@flareapp/core',
            '1.0.0',
        );
        const out = env.resourceSpans[0].scopeSpans[0].spans[0];
        expect(out.parentSpanId).toBe('c'.repeat(16));
        expect(out.droppedAttributesCount).toBe(1);
        expect(out.droppedEventsCount).toBe(3);
        expect(out.events[0].droppedAttributesCount).toBe(2);
    });

    it('encodes resource attributes and omits status.message when unset', () => {
        const env = buildTracesEnvelope([span()], { 'service.name': 'web' }, 'scope', '2');
        expect(env.resourceSpans[0].resource.attributes).toEqual([
            { key: 'service.name', value: { stringValue: 'web' } },
        ]);
        expect(env.resourceSpans[0].scopeSpans[0].scope.name).toBe('scope');
        expect('message' in env.resourceSpans[0].scopeSpans[0].spans[0].status).toBe(false);
    });

    it('produces the full envelope matching the PHP OpenTelemetryJsonExporter golden fixture', () => {
        const input: BufferedSpan = {
            traceId: 'a'.repeat(32),
            spanId: 'b'.repeat(16),
            parentSpanId: 'c'.repeat(16),
            name: 'GET /products/{id}',
            startTimeUnixNano: 1000,
            endTimeUnixNano: 2000,
            status: { code: 2, message: 'boom' },
            recordAttributes: [
                { key: 'flare.span_type', value: { stringValue: 'browser_fetch' } },
                { key: 'http.request.method', value: { stringValue: 'GET' } },
            ],
            resourceAttributes: { 'service.name': 'web' },
            droppedAttributesCount: 1,
            droppedEventsCount: 0,
            events: [
                {
                    name: 'fetchStart',
                    timeUnixNano: 1500,
                    attributes: [{ key: 'url', value: { stringValue: '/api' } }],
                    droppedAttributesCount: 0,
                },
            ],
        };
        const env = buildTracesEnvelope([input], { 'service.name': 'web' }, '@flareapp/core', '1.0.0');
        expect(env).toEqual(fixture);
    });
});
