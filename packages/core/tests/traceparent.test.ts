import { describe, expect, it } from 'vitest';

import { buildTraceparent, parseTraceparent } from '../src/tracing/traceparent';

const TID = 'a'.repeat(32);
const SID = 'b'.repeat(16);

describe('buildTraceparent', () => {
    it('emits sampled flag as exactly 01 / 00', () => {
        expect(buildTraceparent(TID, SID, true)).toBe(`00-${TID}-${SID}-01`);
        expect(buildTraceparent(TID, SID, false)).toBe(`00-${TID}-${SID}-00`);
    });
});

describe('parseTraceparent', () => {
    it('parses a well-formed header', () => {
        expect(parseTraceparent(`00-${TID}-${SID}-01`)).toEqual({
            traceId: TID,
            parentSpanId: SID,
            sampled: true,
        });
    });

    it('reads the sampled bit from the trace-flags bit field', () => {
        // trace-flags is a bit field; only bit 0 (sampled) is defined. OTel SDKs also
        // set bit 1 (random-trace-id), emitting 03/09 — those are still sampled.
        expect(parseTraceparent(`00-${TID}-${SID}-00`)?.sampled).toBe(false);
        expect(parseTraceparent(`00-${TID}-${SID}-01`)?.sampled).toBe(true);
        expect(parseTraceparent(`00-${TID}-${SID}-02`)?.sampled).toBe(false); // random bit only
        expect(parseTraceparent(`00-${TID}-${SID}-03`)?.sampled).toBe(true); // random + sampled
        expect(parseTraceparent(`00-${TID}-${SID}-09`)?.sampled).toBe(true);
    });

    it('returns null for malformed headers', () => {
        expect(parseTraceparent('')).toBeNull();
        expect(parseTraceparent(`00-${TID}-${SID}`)).toBeNull(); // 3 parts
        expect(parseTraceparent(`01-${TID}-${SID}-01`)).toBeNull(); // wrong version
        expect(parseTraceparent(`00-${'z'.repeat(32)}-${SID}-01`)).toBeNull(); // non-hex trace id
        expect(parseTraceparent(`00-${'a'.repeat(31)}-${SID}-01`)).toBeNull(); // short trace id
        expect(parseTraceparent(`00-${'0'.repeat(32)}-${SID}-01`)).toBeNull(); // all-zero trace id
        expect(parseTraceparent(`00-${TID}-${'0'.repeat(16)}-01`)).toBeNull(); // all-zero span id
        expect(parseTraceparent(`00-${TID}-${SID}-zz`)).toBeNull(); // non-hex flags
        expect(parseTraceparent(`00-${TID}-${SID}-1`)).toBeNull(); // wrong-length flags
    });
});
