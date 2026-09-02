import { evictLruIfNew } from '@flareapp/core';

type Interval = [start: number, end: number];

/**
 * Only a parent that never records leaves an entry behind: an async child that registers after its
 * parent already shipped. The normal path frees every entry the moment the parent records, so this
 * cap is a backstop, not a working limit.
 */
const MAX_TRACKED_PARENTS = 256;

const childIntervals = new Map<string, Interval[]>();

/** Files a recorded child under its parent, so the parent can subtract it. */
export function trackChildInterval(parentSpanId: string, startTimeUnixNano: number, endTimeUnixNano: number): void {
    const existing = childIntervals.get(parentSpanId);
    if (existing) {
        existing.push([startTimeUnixNano, endTimeUnixNano]);
        return;
    }
    evictLruIfNew(childIntervals, parentSpanId, MAX_TRACKED_PARENTS);
    childIntervals.set(parentSpanId, [[startTimeUnixNano, endTimeUnixNano]]);
}

/**
 * Duration minus the time the component's own children already account for, and consumes those
 * children. Grandchildren need no handling: they sit inside a child's interval.
 *
 * Children that record after their parent are not subtracted, so the value is self time at commit.
 * That covers async components and `<Suspense>`, and a vue-router layout too: the initial route
 * resolves after the layout mounted, so the page component's work falls outside the layout's window
 * and the layout keeps its full duration.
 */
export function takeSelfTime(spanId: string, startTimeUnixNano: number, endTimeUnixNano: number): number {
    const children = childIntervals.get(spanId);
    childIntervals.delete(spanId);
    const duration = endTimeUnixNano - startTimeUnixNano;
    if (!children) {
        return Math.max(0, duration);
    }
    return Math.max(0, duration - coveredTime(children, startTimeUnixNano, endTimeUnixNano));
}

export function resetComponentSelfTime(): void {
    childIntervals.clear();
}

/**
 * The union of the intervals, clamped to the parent window. A sum would double-count: React starts
 * every component during render and ends them all during commit, so siblings overlap, and summing
 * their durations exceeds the parent's own.
 */
function coveredTime(intervals: Interval[], start: number, end: number): number {
    intervals.sort((a, b) => a[0] - b[0]);

    let covered = 0;
    let cursor = start;
    for (const [childStart, childEnd] of intervals) {
        const from = Math.max(childStart, cursor);
        const to = Math.min(childEnd, end);
        if (to > from) {
            covered += to - from;
            cursor = to;
        }
    }
    return covered;
}
