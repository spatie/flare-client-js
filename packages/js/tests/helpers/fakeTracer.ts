import type { Config, Span, SpanOptions } from '@flareapp/core';
import { vi } from 'vitest';

import type { HttpTracer } from '../../src/tracing/httpRequestSpan';

export function fakeSpan() {
    const calls = { attrs: {} as Record<string, unknown>, status: undefined as unknown, ended: false };
    const span: Span = {
        traceId: 'a'.repeat(32),
        spanId: 'b'.repeat(16),
        parentSpanId: null,
        name: '',
        isRecording: true,
        setAttribute(k, v) {
            calls.attrs[k] = v;
            return this;
        },
        setStatus(s) {
            calls.status = s;
            return this;
        },
        addEvent() {
            return this;
        },
        end() {
            calls.ended = true;
        },
    };
    return { span, calls };
}

/**
 * `startSpan` creates a FRESH fake span per call (each with its own `calls`), pushing every
 * one's `calls` onto `spans` in call order so multi-request tests can inspect span A vs span B
 * independently. `span`/`calls` still point at the first span so every single-request test can
 * keep using them unchanged.
 */
export function makeTracer(overrides: Partial<Config> = {}) {
    const first = fakeSpan();
    const spans: Array<ReturnType<typeof fakeSpan>['calls']> = [];
    const config = {
        enableTracing: true,
        ingestUrl: 'https://ingress.flareapp.io/v1/errors',
        logsIngestUrl: 'https://ingress.flareapp.io/v1/logs',
        tracesIngestUrl: 'https://ingress.flareapp.io/v1/traces',
        ...overrides,
    } as unknown as Config;
    const startSpan = vi.fn((_name: string, _opts?: SpanOptions) => {
        const { span, calls } = spans.length === 0 ? first : fakeSpan();
        spans.push(calls);
        return span;
    });
    const tracer: HttpTracer = { config, startSpan };
    return { tracer, startSpan, span: first.span, calls: first.calls, spans };
}
