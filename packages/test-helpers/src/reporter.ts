import { type Mock, vi } from 'vitest';

/** A minimal Flare-shaped reporter stub (report + flush) that records reported values into `sent`. */
export function makeReporter(): { reporter: { report: Mock; flush: Mock }; sent: unknown[] } {
    const sent: unknown[] = [];
    const reporter = {
        report: vi.fn((value: unknown) => {
            sent.push(value);
            return Promise.resolve();
        }),
        flush: vi.fn(),
    };
    return { reporter, sent };
}
