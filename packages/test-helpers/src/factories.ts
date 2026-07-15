import type { Report, StackFrame } from '@flareapp/core';

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

/** A minimal valid application StackFrame; override any field per test. */
export function makeStackFrame(overrides: Partial<StackFrame> = {}): StackFrame {
    return {
        file: 'app.ts',
        lineNumber: 1,
        columnNumber: 1,
        method: 'fn',
        isApplicationFrame: true,
        ...overrides,
    };
}
