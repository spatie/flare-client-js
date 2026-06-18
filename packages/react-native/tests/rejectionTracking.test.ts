import { describe, expect, it, vi } from 'vitest';

import { installRejectionTracking } from '../src/handlers/rejectionTracking';

type EnableOpts = {
    allRejections?: boolean;
    onUnhandled?: (id: number, error: unknown) => void;
    onHandled?: (id: number) => void;
};

describe('installRejectionTracking', () => {
    it('enables the engine hook and routes onUnhandled to report with a message', () => {
        let opts: EnableOpts | undefined;
        const enable = (o: EnableOpts) => {
            opts = o;
        };
        const report = vi.fn();

        installRejectionTracking(report, { enable });

        expect(opts?.allRejections).toBe(true);
        opts?.onUnhandled?.(1, new Error('async-boom'));
        expect(report).toHaveBeenCalledWith('async-boom');

        opts?.onUnhandled?.(2, 'string-reason');
        expect(report).toHaveBeenCalledWith('string-reason');
    });

    it('uninstall re-enables with no-op callbacks (no further reports)', () => {
        const calls: EnableOpts[] = [];
        const enable = (o: EnableOpts) => calls.push(o);
        const report = vi.fn();

        const uninstall = installRejectionTracking(report, { enable });
        uninstall();

        // Latest enable() call is the no-op one.
        const last = calls[calls.length - 1];
        last.onUnhandled?.(3, new Error('ignored'));
        expect(report).not.toHaveBeenCalled();
    });

    it('is a no-op when no engine hook is available (null injected)', () => {
        const report = vi.fn();
        const uninstall = installRejectionTracking(report, { enable: null });
        expect(() => uninstall()).not.toThrow();
        expect(report).not.toHaveBeenCalled();
    });
});
