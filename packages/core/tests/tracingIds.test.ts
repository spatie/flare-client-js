import { afterEach, describe, expect, it, vi } from 'vitest';

import { randomHex, spanId, traceId } from '../src/tracing/ids';

describe('tracing ids', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('traceId is 32 lowercase hex chars', () => {
        expect(traceId()).toMatch(/^[0-9a-f]{32}$/);
    });

    it('spanId is 16 lowercase hex chars', () => {
        expect(spanId()).toMatch(/^[0-9a-f]{16}$/);
    });

    it('falls back to Math.random when crypto is unavailable and never returns all-zero', () => {
        vi.stubGlobal('crypto', undefined);
        vi.spyOn(Math, 'random').mockReturnValue(0); // would produce all-zero bytes
        expect(randomHex(1)).toBe('01'); // last byte forced to 1
    });
});
