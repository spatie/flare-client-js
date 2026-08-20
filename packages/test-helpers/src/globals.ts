import { type Mock, vi } from 'vitest';

/** Stub global fetch with a resolved Response-ish `{ status }` (default 201). Returns the mock for assertions. */
export function stubFetch(status = 201): Mock {
    const mock = vi.fn().mockResolvedValue({ status });
    vi.stubGlobal('fetch', mock);
    return mock;
}

/** The frozen wall-clock shared by golden/report tests. */
export const FIXED_TEST_DATE = new Date('2026-04-28T12:00:00.000Z');

/**
 * Install fake timers pinned to a fixed instant (default FIXED_TEST_DATE). Also freezes
 * `performance.timeOrigin`: `vi.useFakeTimers()` freezes `performance.now()` back to 0 but leaves
 * `timeOrigin` at the real wall-clock time the test environment was created, so `defaultNowNano()`
 * (`timeOrigin + now()`) would otherwise read real time instead of the frozen instant. Callers must
 * restore with both `vi.useRealTimers()` and `vi.restoreAllMocks()`.
 */
export function frozenClock(date: Date = FIXED_TEST_DATE): void {
    vi.useFakeTimers();
    vi.setSystemTime(date);
    vi.spyOn(performance, 'timeOrigin', 'get').mockReturnValue(date.getTime());
}
