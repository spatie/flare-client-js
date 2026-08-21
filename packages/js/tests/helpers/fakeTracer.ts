import type { Config, SpanOptions } from '@flareapp/core';
import { fakeRecordingSpan } from '@flareapp/test-helpers';
import { vi } from 'vitest';

import type { HttpTracer } from '../../src/tracing/httpRequestSpan';
import { fakeConfig } from './instrumentation';

export { fakeRecordingSpan };

/**
 * `startSpan` creates a fresh fake span per call (each with its own `calls`), pushing every one's
 * `calls` onto `spans` in call order so multi-request tests can inspect span A vs span B. `span`
 * and `calls` still point at the first span so single-request tests keep using them unchanged.
 */
export function makeTracer(overrides: Partial<Config> = {}) {
    const first = fakeRecordingSpan();
    const spans: Array<ReturnType<typeof fakeRecordingSpan>['calls']> = [];
    const config = fakeConfig(overrides);
    const startSpan = vi.fn((_name: string, _opts?: SpanOptions) => {
        const { span, calls } = spans.length === 0 ? first : fakeRecordingSpan();
        spans.push(calls);
        return span;
    });
    const tracer: HttpTracer = { config, startSpan };
    return { tracer, startSpan, span: first.span, calls: first.calls, spans };
}
