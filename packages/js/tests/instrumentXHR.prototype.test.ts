// @vitest-environment jsdom
import type { Config, Span, SpanOptions } from '@flareapp/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { HttpTracer } from '../src/tracing/httpRequestSpan';
import { instrumentXHR, unpatchXHR } from '../src/tracing/instrumentXHR';

function makeTracer() {
    const span: Span = {
        traceId: 'a'.repeat(32),
        spanId: 'b'.repeat(16),
        parentSpanId: null,
        name: '',
        isRecording: true,
        setAttribute() {
            return this;
        },
        setStatus() {
            return this;
        },
        addEvent() {
            return this;
        },
        end() {},
    };
    const config = { enableTracing: true } as unknown as Config;
    const startSpan = vi.fn((_n: string, _o?: SpanOptions) => span);
    const tracer: HttpTracer = { config, startSpan };
    return { tracer, startSpan };
}

describe('instrumentXHR / unpatchXHR on XMLHttpRequest.prototype', () => {
    afterEach(() => unpatchXHR());

    it('patches open/send/setRequestHeader and restores them', () => {
        const proto = XMLHttpRequest.prototype as unknown as Record<string, { __flare_original__?: unknown }>;
        const nativeSend = proto.send;
        const { tracer } = makeTracer();

        instrumentXHR(tracer);
        expect(proto.send).not.toBe(nativeSend);
        expect((proto.send as { __flare_original__?: unknown }).__flare_original__).toBe(nativeSend);
        expect((proto.open as { __flare_original__?: unknown }).__flare_original__).toBeDefined();
        expect((proto.setRequestHeader as { __flare_original__?: unknown }).__flare_original__).toBeDefined();

        unpatchXHR();
        expect(proto.send).toBe(nativeSend);
    });

    it('is idempotent (a second instrumentXHR does not stack a wrapper)', () => {
        const proto = XMLHttpRequest.prototype as unknown as Record<string, unknown>;
        const { tracer } = makeTracer();

        instrumentXHR(tracer);
        const firstSend = proto.send;
        instrumentXHR(tracer);
        expect(proto.send).toBe(firstSend);
    });

    it('open without send creates no span (reused instance stays inert until send)', () => {
        const { tracer, startSpan } = makeTracer();
        instrumentXHR(tracer);

        const xhr = new XMLHttpRequest();
        xhr.open('GET', 'https://app.example/one');
        // open again reuses the instance; still no send() -> still no span.
        xhr.open('GET', 'https://app.example/two');
        expect(startSpan).not.toHaveBeenCalled();
    });

    it('a third party wrapping send does not wedge open permanently (Finding 2 regression)', () => {
        const proto = XMLHttpRequest.prototype as unknown as Record<string, { __flare_original__?: unknown }>;
        const { tracer, startSpan } = makeTracer();

        instrumentXHR(tracer);
        const flareSend = proto.send;

        // A third party wraps `send` on top of Flare's wrapper, so unpatchXHR cannot
        // restore it (mirrors instrumentFetch.test.ts's third-party test).
        const thirdParty = function (this: XMLHttpRequest, ...args: unknown[]): unknown {
            return (flareSend as unknown as (...a: unknown[]) => unknown).apply(this, args);
        };
        proto.send = thirdParty as unknown as { __flare_original__?: unknown };

        unpatchXHR();
        expect(proto.send).toBe(thirdParty); // the leak is real

        instrumentXHR(tracer); // re-enable must not permanently wedge `open`

        // (a) open is still Flare's wrapper -> tracing is not permanently dead.
        expect((proto.open as { __flare_original__?: unknown }).__flare_original__).toBeDefined();

        // (b) driving one traced request through open() -> send() creates exactly one
        // span -> re-instrumenting did not stack a second `send` wrapper underneath
        // the still-leaked third party.
        const xhr = new XMLHttpRequest();
        xhr.open('GET', 'https://app.example/one');
        xhr.send();
        expect(startSpan).toHaveBeenCalledTimes(1);

        // Unwind the third party so afterEach's unpatchXHR can fully restore natives.
        proto.send = flareSend;
    });
});
