import { describe, expect, test, vi } from 'vitest';

import { describeRejectionReason, routeRejection } from '../src/util/rejection';

describe('describeRejectionReason', () => {
    test('returns a string reason verbatim', () => {
        expect(describeRejectionReason('boom')).toBe('boom');
    });

    test('uses a non-empty object .message', () => {
        expect(describeRejectionReason({ message: 'kaboom' })).toBe('kaboom');
    });

    test('falls through to JSON for an object with an empty .message', () => {
        // An empty message is useless; the serialized object carries more signal. Locks the deliberate divergence from
        // the pre-refactor browser path, which returned the empty string.
        expect(describeRejectionReason({ message: '', code: 42 })).toBe('{"message":"","code":42}');
    });

    test('describes a non-serializable reason without throwing', () => {
        const circular: Record<string, unknown> = {};
        circular.self = circular;
        expect(describeRejectionReason(circular)).toBe('Unhandled promise rejection (non-serializable reason)');
    });

    test('coerces a non-object, non-string reason', () => {
        expect(describeRejectionReason(42)).toBe('42');
        expect(describeRejectionReason(null)).toBe('null');
    });
});

describe('routeRejection', () => {
    test('an Error reason keeps its stack via reportSilently', () => {
        const reporter = { reportSilently: vi.fn(), reportUnhandledRejection: vi.fn() };
        const error = new Error('nope');

        routeRejection(reporter, error);

        expect(reporter.reportSilently).toHaveBeenCalledWith(error);
        expect(reporter.reportUnhandledRejection).not.toHaveBeenCalled();
    });

    test('a stack-bearing object is reported as an Error with its stack preserved', () => {
        const reporter = { reportSilently: vi.fn(), reportUnhandledRejection: vi.fn() };

        routeRejection(reporter, { message: 'boom', stack: 'at foo' });

        expect(reporter.reportSilently).toHaveBeenCalledTimes(1);
        const reported = reporter.reportSilently.mock.calls[0][0];
        expect(reported).toBeInstanceOf(Error);
        expect(reported.message).toBe('boom');
        expect(reported.stack).toBe('at foo');
        expect(reporter.reportUnhandledRejection).not.toHaveBeenCalled();
    });

    test('a stackless reason falls back to reportUnhandledRejection', () => {
        const reporter = { reportSilently: vi.fn(), reportUnhandledRejection: vi.fn() };

        routeRejection(reporter, 'just a string');

        expect(reporter.reportUnhandledRejection).toHaveBeenCalledWith('just a string');
        expect(reporter.reportSilently).not.toHaveBeenCalled();
    });

    test('swallows a rejection from reportUnhandledRejection so transport failure does not re-surface', async () => {
        const reporter = {
            reportSilently: vi.fn(),
            reportUnhandledRejection: vi.fn(() => Promise.reject(new Error('transport failed'))),
        };

        expect(() => routeRejection(reporter, 'x')).not.toThrow();
        // Let the swallowing `.catch` run; an unhandled rejection here would fail the run.
        await Promise.resolve();
    });
});
