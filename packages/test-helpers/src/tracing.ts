import type { Span } from '@flareapp/core';

export function fakeSpan() {
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
