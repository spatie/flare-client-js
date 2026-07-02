import { describe, expect, it } from 'vitest';

import { computePageloadStartNano } from '../src/tracing/navigationTiming';

describe('computePageloadStartNano', () => {
    it('returns timeOrigin + entry.startTime in nanoseconds', () => {
        // timeOrigin 1_000 ms, nav entry startTime 0 → 1_000 ms → 1_000 * 1e6 ns
        expect(computePageloadStartNano(1_000, 0)).toBe(1_000 * 1e6);
        // startTime 5 ms offset
        expect(computePageloadStartNano(1_000, 5)).toBe(1_005 * 1e6);
    });

    it('falls back to timeOrigin when startTime is undefined', () => {
        expect(computePageloadStartNano(2_000, undefined)).toBe(2_000 * 1e6);
    });
});
