import { defaultNowNano } from '@flareapp/core';

/** Pure math seam (unit-testable): timeOrigin(ms) + startTime(ms) → unix nanos. */
export function computePageloadStartNano(timeOriginMs: number, startTimeMs: number | undefined): number {
    return Math.round((timeOriginMs + (startTimeMs ?? 0)) * 1e6);
}

/**
 * The pageload root's start time in unix nanoseconds, backdated to navigation
 * start via the Navigation Timing entry. Falls back to the tracer's clock when
 * the API is unavailable.
 */
export function pageloadStartNano(): number {
    const perf = (globalThis as { performance?: Performance }).performance;
    if (!perf || typeof perf.getEntriesByType !== 'function' || typeof perf.timeOrigin !== 'number') {
        return defaultNowNano();
    }
    const entry = perf.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    return computePageloadStartNano(perf.timeOrigin, entry?.startTime);
}
