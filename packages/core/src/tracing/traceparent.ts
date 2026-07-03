const HEX32 = /^[0-9a-f]{32}$/;
const HEX16 = /^[0-9a-f]{16}$/;
const HEX8 = /^[0-9a-f]{2}$/;
const ZERO32 = '0'.repeat(32);
const ZERO16 = '0'.repeat(16);

export function buildTraceparent(traceId: string, spanId: string, sampled: boolean): string {
    return `00-${traceId}-${spanId}-${sampled ? '01' : '00'}`;
}

export function parseTraceparent(header: string): { traceId: string; parentSpanId: string; sampled: boolean } | null {
    const parts = header.trim().split('-');
    if (parts.length !== 4) return null;
    const [version, traceId, spanId, flags] = parts;
    if (version !== '00') return null;
    if (!HEX32.test(traceId) || traceId === ZERO32) return null;
    if (!HEX16.test(spanId) || spanId === ZERO16) return null;
    if (!HEX8.test(flags)) return null;
    // trace-flags is a bit field (W3C). Only the low bit (sampled) is defined;
    // current OTel SDKs also set the random-trace-id bit, emitting 03/09/etc.
    return { traceId, parentSpanId: spanId, sampled: (parseInt(flags, 16) & 0x01) === 1 };
}
