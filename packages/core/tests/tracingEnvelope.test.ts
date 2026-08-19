import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { attributesToOpenTelemetry } from '../src/logging/otel';
import { buildTracesEnvelope, emptyTracesEnvelopeBytes, otelSpanBytes } from '../src/tracing/envelope';
import type { BufferedSpan } from '../src/types';
import { flatJsonStringify } from '../src/util';

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

    // SpanBuffer.estimateBytes and Api.traces dropped safeClone on the strength of this: a BufferedSpan has been
    // through attributesToOpenTelemetry, so cloning it cannot change a single byte. If a future field breaks that,
    // the measured size and the shipped body silently stop agreeing, so pin it.
    it('stringifies byte-identically with and without safeClone', () => {
        const cyclic: Record<string, unknown> = { a: 1 };
        cyclic.self = cyclic;
        const tricky = span({
            name: 'requête café',
            status: { code: 2, message: 'failed "500" \\ café' },
            recordAttributes: attributesToOpenTelemetry({
                'user.naïve': 'Ünïcödé 日本語 → ∑',
                'astral': '\u{1D11E}',
                'nested': { a: { b: [1, 'two', false, 0.5] } },
                'cyclic': cyclic as never,
                'dropped': 10n as never,
                'ctl': '\n\t\b',
            }),
            events: [
                {
                    name: 'exception',
                    timeUnixNano: 5,
                    attributes: attributesToOpenTelemetry({ 'exception.message': 'boom café' }),
                    droppedAttributesCount: 1,
                },
            ],
        });
        const env = buildTracesEnvelope([tricky, span()], { 'service.name': 'café', 'nested': { a: [1] } }, 's', '2');

        expect(JSON.stringify(tricky)).toBe(flatJsonStringify(tricky));
        expect(JSON.stringify(env)).toBe(flatJsonStringify(env));
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

describe('envelope byte arithmetic', () => {
    const encoder = new TextEncoder();
    const resource = { 'service.name': 'web' };

    it('an envelope is the empty envelope plus each span plus one comma per extra span', () => {
        const spans = [
            span(),
            span({ spanId: 'c'.repeat(16), status: { code: 2, message: 'boom' } }),
            span({ spanId: 'd'.repeat(16), name: 'GET /produits/日本語-café' }),
        ];
        const actual = encoder.encode(
            JSON.stringify(buildTracesEnvelope(spans, resource, '@flareapp/core', '1.0.0')),
        ).length;
        const predicted =
            emptyTracesEnvelopeBytes(resource, '@flareapp/core', '1.0.0') +
            spans.reduce((sum, s) => sum + otelSpanBytes(s), 0) +
            (spans.length - 1);

        expect(predicted).toBe(actual);
    });
});
