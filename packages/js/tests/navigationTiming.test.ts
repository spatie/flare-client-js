import { describe, expect, it } from 'vitest';

import {
    computePageloadEndNano,
    computePageloadStartNano,
    resolvePageloadStartNano,
} from '../src/tracing/navigationTiming';

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

describe('resolvePageloadStartNano', () => {
    const FINAL = 30_000 * 1e6; // 30s in nanos

    it('backdates to navigation start while the window is still open', () => {
        const backdated = 1_000 * 1e6;
        const now = backdated + 5_000 * 1e6; // 5s later, within the 30s cap
        expect(resolvePageloadStartNano(backdated, now, FINAL, false)).toBe(backdated);
    });

    it('uses now when tracing is enabled past the final cap (no bogus backdated duration)', () => {
        const backdated = 1_000 * 1e6;
        const now = backdated + 45_000 * 1e6; // 45s later, beyond the 30s cap
        expect(resolvePageloadStartNano(backdated, now, FINAL, false)).toBe(now);
    });

    it('uses now when the pageload was already traced (re-enable does not backdate again)', () => {
        const backdated = 1_000 * 1e6;
        const now = backdated + 2_000 * 1e6; // within the cap, but already traced
        expect(resolvePageloadStartNano(backdated, now, FINAL, true)).toBe(now);
    });
});

describe('computePageloadEndNano', () => {
    const NOW = 9_999 * 1e6;

    it('returns timeOrigin + loadEventEnd in nanoseconds', () => {
        // timeOrigin 1_000 ms, loadEventEnd 488 ms → 1_488 ms → * 1e6 ns
        expect(computePageloadEndNano(1_000, 488, 300, NOW)).toBe(1_488 * 1e6);
    });

    it('falls back to domContentLoadedEventEnd when the load event has not fired yet', () => {
        // loadEventEnd 0 (unset) → use DCL 300 ms
        expect(computePageloadEndNano(1_000, 0, 300, NOW)).toBe(1_300 * 1e6);
    });

    it('falls back to now when neither the load nor DCL event has fired', () => {
        expect(computePageloadEndNano(1_000, 0, 0, NOW)).toBe(NOW);
        expect(computePageloadEndNano(1_000, undefined, undefined, NOW)).toBe(NOW);
    });
});
