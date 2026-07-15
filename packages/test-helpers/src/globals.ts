import { type Mock, vi } from 'vitest';

/** Stub global fetch with a resolved Response-ish `{ status }` (default 201). Returns the mock for assertions. */
export function stubFetch(status = 201): Mock {
    const mock = vi.fn().mockResolvedValue({ status });
    vi.stubGlobal('fetch', mock);
    return mock;
}

/** The frozen wall-clock shared by golden/report tests. */
export const FIXED_TEST_DATE = new Date('2026-04-28T12:00:00.000Z');

/** Install fake timers pinned to a fixed instant (default FIXED_TEST_DATE). */
export function frozenClock(date: Date = FIXED_TEST_DATE): void {
    vi.useFakeTimers();
    vi.setSystemTime(date);
}

/** The `{ setSdkInfo, setFramework }` Flare stub used by every framework's identify test. */
export function fakeIdentity(): { setSdkInfo: Mock; setFramework: Mock } {
    return { setSdkInfo: vi.fn(), setFramework: vi.fn() };
}
