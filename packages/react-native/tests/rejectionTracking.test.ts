import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    installRejectionTracking,
    resolveRejectionEnabler,
    type RejectionReporter,
} from '../src/handlers/rejectionTracking';

type EnableOpts = {
    allRejections?: boolean;
    onUnhandled?: (id: number, error: unknown) => void;
    onHandled?: (id: number) => void;
};

function fakeReporter(): RejectionReporter & {
    silently: ReturnType<typeof vi.fn>;
    unhandled: ReturnType<typeof vi.fn>;
} {
    const silently = vi.fn();
    const unhandled = vi.fn();
    return { reportSilently: silently, reportUnhandledRejection: unhandled, silently, unhandled };
}

afterEach(() => {
    delete (globalThis as Record<string, unknown>).HermesInternal;
    delete (globalThis as Record<string, unknown>).__DEV__;
});

describe('installRejectionTracking routing', () => {
    it('enables with allRejections and routes an Error reason to reportSilently (stack preserved)', () => {
        let opts: EnableOpts | undefined;
        const enable = (o: EnableOpts) => {
            opts = o;
        };
        const reporter = fakeReporter();
        installRejectionTracking(reporter, { enable });

        expect(opts?.allRejections).toBe(true);

        const err = new Error('async-boom');
        opts?.onUnhandled?.(1, err);
        expect(reporter.silently).toHaveBeenCalledWith(err); // same Error instance, stack intact
        expect(reporter.unhandled).not.toHaveBeenCalled();
    });

    it('routes a stack-bearing object reason to reportSilently with a synthesized Error', () => {
        let opts: EnableOpts | undefined;
        const reporter = fakeReporter();
        installRejectionTracking(reporter, {
            enable: (o: EnableOpts) => {
                opts = o;
            },
        });

        opts?.onUnhandled?.(2, { message: 'objmsg', stack: 'at foo (a.js:1)' });
        expect(reporter.silently).toHaveBeenCalledTimes(1);
        const passed = reporter.silently.mock.calls[0][0] as Error;
        expect(passed).toBeInstanceOf(Error);
        expect(passed.message).toBe('objmsg');
        expect(passed.stack).toBe('at foo (a.js:1)');
    });

    it('routes a plain object reason to reportUnhandledRejection with JSON (not [object Object])', () => {
        let opts: EnableOpts | undefined;
        const reporter = fakeReporter();
        installRejectionTracking(reporter, {
            enable: (o: EnableOpts) => {
                opts = o;
            },
        });

        opts?.onUnhandled?.(3, { code: 42 });
        expect(reporter.unhandled).toHaveBeenCalledWith('{"code":42}');
        expect(reporter.silently).not.toHaveBeenCalled();
    });

    it('routes a string reason to reportUnhandledRejection', () => {
        let opts: EnableOpts | undefined;
        const reporter = fakeReporter();
        installRejectionTracking(reporter, {
            enable: (o: EnableOpts) => {
                opts = o;
            },
        });

        opts?.onUnhandled?.(4, 'string-reason');
        expect(reporter.unhandled).toHaveBeenCalledWith('string-reason');
    });

    it('uninstall re-enables with no-op callbacks (no further reports)', () => {
        const calls: EnableOpts[] = [];
        const reporter = fakeReporter();
        const uninstall = installRejectionTracking(reporter, { enable: (o: EnableOpts) => calls.push(o) });
        uninstall();

        const last = calls[calls.length - 1];
        last.onUnhandled?.(5, new Error('ignored'));
        expect(reporter.silently).not.toHaveBeenCalled();
        expect(reporter.unhandled).not.toHaveBeenCalled();
    });

    it('is a no-op when no engine hook is available (null injected)', () => {
        const reporter = fakeReporter();
        const uninstall = installRejectionTracking(reporter, { enable: null });
        expect(() => uninstall()).not.toThrow();
        expect(reporter.silently).not.toHaveBeenCalled();
        expect(reporter.unhandled).not.toHaveBeenCalled();
    });

    it('does not crash when the engine hook throws on enable', () => {
        const reporter = fakeReporter();
        const throwingEnable = () => {
            throw new Error('engine boom');
        };
        let uninstall: (() => void) | undefined;
        expect(() => {
            uninstall = installRejectionTracking(reporter, { enable: throwingEnable });
        }).not.toThrow();
        expect(() => uninstall?.()).not.toThrow();
    });
});

describe('resolveRejectionEnabler engine detection', () => {
    it('prefers the Hermes hook when present', () => {
        const hermesEnable = vi.fn();
        const enabler = resolveRejectionEnabler({
            hermes: { enablePromiseRejectionTracker: hermesEnable },
            requirePolyfill: null,
        });
        expect(enabler).not.toBeNull();
        enabler?.({ allRejections: true });
        expect(hermesEnable).toHaveBeenCalledWith({ allRejections: true });
    });

    it('falls back to the polyfill require when Hermes is absent', () => {
        const polyfillEnable = vi.fn();
        const enabler = resolveRejectionEnabler({
            hermes: null,
            requirePolyfill: () => ({ enable: polyfillEnable }),
        });
        expect(enabler).not.toBeNull();
        enabler?.({ allRejections: true });
        expect(polyfillEnable).toHaveBeenCalledWith({ allRejections: true });
    });

    it('ignores HermesInternal when enablePromiseRejectionTracker is not a function', () => {
        const enabler = resolveRejectionEnabler({
            hermes: { enablePromiseRejectionTracker: 123 as unknown as () => void },
            requirePolyfill: null,
        });
        expect(enabler).toBeNull();
    });

    it('returns null when Hermes is absent and the polyfill require throws', () => {
        const enabler = resolveRejectionEnabler({
            hermes: null,
            requirePolyfill: () => {
                throw new Error('not found');
            },
        });
        expect(enabler).toBeNull();
    });

    it('returns null when the polyfill resolves without a usable enable()', () => {
        const enabler = resolveRejectionEnabler({ hermes: null, requirePolyfill: () => ({}) });
        expect(enabler).toBeNull();
    });
});

describe('dev-mode logging', () => {
    it('emits a console.warn for an unhandled rejection in dev', () => {
        (globalThis as Record<string, unknown>).__DEV__ = true;
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const reporter = fakeReporter();
        let opts: EnableOpts | undefined;
        installRejectionTracking(reporter, {
            enable: (o: EnableOpts) => {
                opts = o;
            },
        });

        opts?.onUnhandled?.(1, new Error('dev-boom'));
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it('does not warn outside dev', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const reporter = fakeReporter();
        let opts: EnableOpts | undefined;
        installRejectionTracking(reporter, {
            enable: (o: EnableOpts) => {
                opts = o;
            },
        });

        opts?.onUnhandled?.(1, new Error('prod-boom'));
        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
    });
});
