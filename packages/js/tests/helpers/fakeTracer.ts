import type { Config, SpanOptions } from '@flareapp/core';
import { fakeRecordingSpan } from '@flareapp/test-helpers';
import { vi } from 'vitest';

import type { HttpTracer } from '../../src/tracing/requests';

export { fakeRecordingSpan };

// `startSpan` makes a fresh fake span per call, recording each one's `calls` onto `spans` in order.
// `span` and `calls` still point at the first span, so single-request tests keep working unchanged.
export function makeTracer(overrides: Partial<Config> = {}) {
    const first = fakeRecordingSpan();
    const spans: Array<ReturnType<typeof fakeRecordingSpan>['calls']> = [];
    const config = {
        enableTracing: true,
        ingestUrl: 'https://ingress.flareapp.io/v1/errors',
        logsIngestUrl: 'https://ingress.flareapp.io/v1/logs',
        tracesIngestUrl: 'https://ingress.flareapp.io/v1/traces',
        ...overrides,
    } as unknown as Config;
    const startSpan = vi.fn((_name: string, _opts?: SpanOptions) => {
        const { span, calls } = spans.length === 0 ? first : fakeRecordingSpan();
        spans.push(calls);
        return span;
    });
    const tracer: HttpTracer = { config, startSpan };
    return { tracer, startSpan, span: first.span, calls: first.calls, spans };
}
