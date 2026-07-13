import { defaultNowNano } from '@flareapp/core';

/** Pure math seam (unit-testable): timeOrigin(ms) + startTime(ms) → unix nanos. */
export function computePageloadStartNano(timeOriginMs: number, startTimeMs: number | undefined): number {
    return Math.round((timeOriginMs + (startTimeMs ?? 0)) * 1e6);
}

/**
 * Choose the pageload root's start time: navigation start while that window is still open,
 * otherwise `now`. Starting at `now` (when tracing began after the final cap, or the pageload was
 * already traced) avoids a backdated root reporting a bogus multi-second duration.
 */
export function resolvePageloadStartNano(
    backdatedNano: number,
    nowNano: number,
    finalTimeoutNano: number,
    alreadyTraced: boolean,
): number {
    if (alreadyTraced) return nowNano;
    if (nowNano - backdatedNano > finalTimeoutNano) return nowNano;
    return backdatedNano;
}

/**
 * The pageload root's start time in unix nanoseconds, backdated to navigation start via the
 * Navigation Timing entry. Falls back to the tracer's clock when the API is unavailable.
 */
export function pageloadStartNano(): number {
    const perf = (globalThis as { performance?: Performance }).performance;
    if (!perf || typeof perf.getEntriesByType !== 'function' || typeof perf.timeOrigin !== 'number') {
        return defaultNowNano();
    }
    const entry = perf.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    return computePageloadStartNano(perf.timeOrigin, entry?.startTime);
}

/** Pure math seam (unit-testable): timeOrigin(ms) + load-event-end(ms) → unix nanos; `now` when unset. */
export function computePageloadEndNano(
    timeOriginMs: number,
    loadEventEndMs: number | undefined,
    domContentLoadedEventEndMs: number | undefined,
    nowNano: number,
): number {
    const endMs = loadEventEndMs || domContentLoadedEventEndMs || 0;
    if (!endMs) return nowNano;
    return Math.round((timeOriginMs + endMs) * 1e6);
}

/**
 * The pageload root's end time in unix nanoseconds, taken from the Navigation
 * Timing `loadEventEnd` (the browser's own "page finished loading" mark), falling
 * back to `domContentLoadedEventEnd`, then the tracer's clock when neither has
 * fired yet or the API is unavailable. Used as the pageload root's close floor so a
 * childless pageload reports its real load duration rather than idle-timeout padding.
 */
export function pageloadEndNano(): number {
    const perf = (globalThis as { performance?: Performance }).performance;
    if (!perf || typeof perf.getEntriesByType !== 'function' || typeof perf.timeOrigin !== 'number') {
        return defaultNowNano();
    }
    const entry = perf.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    return computePageloadEndNano(
        perf.timeOrigin,
        entry?.loadEventEnd,
        entry?.domContentLoadedEventEnd,
        defaultNowNano(),
    );
}
