import type { BreadcrumbLimits, Report } from '@flareapp/core';
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

/** The real `Config` defaults for the breadcrumb buffer; override any field per test. */
export function breadcrumbLimits(overrides: Partial<BreadcrumbLimits> = {}): BreadcrumbLimits {
    return {
        maxBreadcrumbs: 100,
        maxBreadcrumbBytes: 64_000,
        maxBreadcrumbEntryBytes: 8_000,
        maxGlowsPerReport: 30,
        ...overrides,
    };
}

/** The `{ setSdkInfo, setFramework }` Flare stub used by every framework's identify test. */
export function fakeIdentity(): { setSdkInfo: Mock; setFramework: Mock } {
    return { setSdkInfo: vi.fn(), setFramework: vi.fn() };
}
