import { vi } from 'vitest';

export type FakeComponentRoot = { traceId: string; parentSpanId: string } | null;

export type RecordedComponentSpan = {
    name: string;
    spanId: string;
    parent: { traceId: string; parentSpanId: string };
    startTimeUnixNano: number;
    endTimeUnixNano: number;
};

export type FakeComponentSeam = {
    activeComponentRoot: ReturnType<typeof vi.fn>;
    reserveSpanId: ReturnType<typeof vi.fn>;
    recordComponentSpan: ReturnType<typeof vi.fn>;
    nowNano: ReturnType<typeof vi.fn>;
    /** Swap what the live root is, including to null for "tracing off or no root open". */
    setRoot(root: FakeComponentRoot): void;
    /**
     * Make `nowNano` climb on every call, so a test can tell a span's start and end apart. Off by
     * default, since a frozen clock keeps timestamp assertions readable as literals.
     */
    advanceClock(stepNano?: number): void;
    /** The spans the seam was asked to record, in order. */
    spans(): RecordedComponentSpan[];
    /** Back to a single recording root, a frozen clock, an empty span log and a span-id counter at zero. */
    reset(): void;
};

/**
 * The component-profiler seam fake shared by the React and Vue profiler suites. Reserved span ids are
 * counter-backed (`s1`, `s2`, ...) so a test can assert a child's parent id by name instead of
 * threading the real random id through the assertion.
 */
export function createComponentSeam(): FakeComponentSeam {
    let counter = 0;
    let root: FakeComponentRoot = { traceId: 'T', parentSpanId: 'root' };
    let clock = 1000;
    let step = 0;
    const recorded: RecordedComponentSpan[] = [];

    const readClock = () => {
        const now = clock;
        clock += step;
        return now;
    };
    const record = (span: RecordedComponentSpan) => {
        recorded.push(span);
    };

    const seam: FakeComponentSeam = {
        activeComponentRoot: vi.fn(() => root),
        reserveSpanId: vi.fn(() => `s${++counter}`),
        recordComponentSpan: vi.fn(record),
        nowNano: vi.fn(readClock),
        setRoot(next) {
            root = next;
        },
        advanceClock(stepNano = 1) {
            step = stepNano;
        },
        spans: () => recorded,
        reset() {
            counter = 0;
            clock = 1000;
            step = 0;
            recorded.length = 0;
            root = { traceId: 'T', parentSpanId: 'root' };
            // mockReset, not mockClear. mockClear only wipes call state and leaves a mockImplementation
            // in place, so a test that makes the seam throw would leak that throw into every later test
            // in the file (see @vitest/spy: mockClear touches state, mockReset touches config).
            // Re-installing the implementation explicitly keeps this independent of what mockReset
            // restores by default.
            seam.activeComponentRoot.mockReset().mockImplementation(() => root);
            seam.reserveSpanId.mockReset().mockImplementation(() => `s${++counter}`);
            seam.recordComponentSpan.mockReset().mockImplementation(record);
            seam.nowNano.mockReset().mockImplementation(readClock);
        },
    };

    return seam;
}

/**
 * The `@flareapp/js/browser` mock for a profiler suite. Only the four seam functions are faked; pass
 * the real module as `original` and everything else stays real, so a suite cannot pass against a
 * hand-written stand-in that has drifted from the code it stands in for. Same approach as
 * `browserSeamMock`.
 *
 *     vi.mock('@flareapp/js/browser', async (importOriginal) =>
 *         (await import('@flareapp/test-helpers')).componentProfilerMock(seam, await importOriginal()));
 */
export function componentProfilerMock(
    seam: FakeComponentSeam,
    original: Record<string, unknown>,
): Record<string, unknown> {
    return {
        ...original,
        activeComponentRoot: seam.activeComponentRoot,
        reserveSpanId: seam.reserveSpanId,
        recordComponentSpan: seam.recordComponentSpan,
        nowNano: seam.nowNano,
    };
}
