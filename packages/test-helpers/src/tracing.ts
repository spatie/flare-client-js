import type { Span } from '@flareapp/core';

/**
 * Stand-in for the browser's native `fetch`. `isNativeFetch` detects native functions via
 * `Function.prototype.toString.call`, which reports "[native code]" for a bound function but ignores
 * an own `toString` override. The `.bind` is load-bearing: without it, `supportsNativeFetch()` returns
 * false and tests using this stub silently become no-ops that still pass.
 */
export function nativeFetchStub(): typeof fetch {
    // oxlint-disable-next-line no-extra-bind
    return (async () => new Response(null, { status: 200 })).bind(null) as unknown as typeof fetch;
}

export type FakeSpan = { span: Span; calls: { attrs: Record<string, unknown>; status: unknown; ended: boolean } };

export function fakeRecordingSpan(): FakeSpan {
    const calls = { attrs: {} as Record<string, unknown>, status: undefined as unknown, ended: false };
    const span: Span = {
        traceId: 'a'.repeat(32),
        spanId: 'b'.repeat(16),
        parentSpanId: null,
        name: '',
        isRecording: true,
        endTimeUnixNano: 0,
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
