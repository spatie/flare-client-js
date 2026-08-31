import type { Flare } from '@flareapp/core';

import type { ElectronFatalMode } from '../types';

type FatalOptions = {
    uncaughtExceptionMode: ElectronFatalMode;
    unhandledRejectionMode: ElectronFatalMode;
    shutdownTimeoutMs: number;
};

// Fatal callbacks for Electron main. Mirrors @flareapp/node's buildFatalCallbacks, but exits via the
// injected `exit` (app.exit), which is immediate and skips before-quit/will-quit — safe post-crash.
export function buildFatalCallbacks(flare: Flare, getOpts: () => FatalOptions, exit: (code: number) => void) {
    return {
        async onUncaught(err: unknown, origin: string): Promise<void> {
            const opts = getOpts();
            if (opts.uncaughtExceptionMode === 'report-and-exit') {
                process.exitCode = 1;
            }
            const error = err instanceof Error ? err : new Error(String(err));
            try {
                await flare.report(error, { 'process.uncaught_exception.origin': origin });
            } catch {
                // swallow
            }
            // Only drain other in-flight reports when about to exit. In 'report' mode the process
            // keeps running, so they settle on their own. Mirrors onRejection.
            if (opts.uncaughtExceptionMode === 'report-and-exit') {
                await flare.flush(opts.shutdownTimeoutMs);
                exit(1);
            }
        },
        async onRejection(reason: unknown): Promise<void> {
            const opts = getOpts();
            if (opts.unhandledRejectionMode === 'report-and-exit') {
                process.exitCode = 1;
            }
            const error = reason instanceof Error ? reason : new Error(String(reason));
            try {
                await flare.report(error);
            } catch {
                // swallow
            }
            if (opts.unhandledRejectionMode === 'report-and-exit') {
                await flare.flush(opts.shutdownTimeoutMs);
                exit(1);
            }
        },
    };
}

type Callbacks = {
    onUncaught: (err: unknown, origin: string) => void;
    onRejection: (reason: unknown) => void;
};

// Owns the process-level error listeners for Electron main, reconciling attach/detach against the
// desired modes (mirrors node's ProcessHandlerManager). Kept as a copy rather than shared: electron
// doesn't depend on node, and core (the one thing both import) must stay browser-safe.
export class ProcessHandlerManager {
    private uncaughtHandler: ((err: unknown, origin: string) => void) | null = null;
    private rejectionHandler: ((reason: unknown) => void) | null = null;

    constructor(private cbs: Callbacks) {}

    reconcile(opts: { uncaughtExceptionMode: ElectronFatalMode; unhandledRejectionMode: ElectronFatalMode }): void {
        this.reconcileOne(
            'uncaughtException',
            opts.uncaughtExceptionMode,
            () => this.uncaughtHandler,
            (h) => {
                this.uncaughtHandler = h;
            },
            (err, origin) => this.cbs.onUncaught(err, origin as string),
        );
        this.reconcileOne(
            'unhandledRejection',
            opts.unhandledRejectionMode,
            () => this.rejectionHandler,
            (h) => {
                this.rejectionHandler = h;
            },
            (reason) => this.cbs.onRejection(reason),
        );
    }

    detach(): void {
        if (this.uncaughtHandler) {
            process.off('uncaughtException', this.uncaughtHandler as any);
            this.uncaughtHandler = null;
        }
        if (this.rejectionHandler) {
            process.off('unhandledRejection', this.rejectionHandler as any);
            this.rejectionHandler = null;
        }
    }

    private reconcileOne(
        event: 'uncaughtException' | 'unhandledRejection',
        mode: ElectronFatalMode,
        get: () => ((...args: any[]) => void) | null,
        set: (h: ((...args: any[]) => void) | null) => void,
        impl: (...args: any[]) => void,
    ): void {
        const current = get();
        const wants = mode !== 'off';
        const attached = current !== null;

        if (wants === attached) {
            return; // already in the desired state
        }
        if (!wants) {
            process.off(event, current as any);
            set(null);
            return;
        }
        set(impl);
        process.on(event, impl as any);
    }
}
