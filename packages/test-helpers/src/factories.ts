import type { Report } from '@flareapp/core';
import { type Mock, vi } from 'vitest';

/** A minimal valid Report; override any field per test. */
export function makeReport(overrides: Partial<Report> = {}): Report {
    return {
        exceptionClass: 'Error',
        message: 'test',
        seenAtUnixNano: 0,
        stacktrace: [],
        events: [],
        attributes: {},
        ...overrides,
    };
}

/** The `{ setSdkInfo, setFramework }` Flare stub used by every framework's identify test. */
export function fakeIdentity(): { setSdkInfo: Mock; setFramework: Mock } {
    return { setSdkInfo: vi.fn(), setFramework: vi.fn() };
}
