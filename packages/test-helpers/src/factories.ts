import type { Report } from '@flareapp/core';

/** A minimal valid Report; override any field per test. Mirrors the old inline `minimalReport` literal. */
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
