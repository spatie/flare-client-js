import type { Flare } from '@flareapp/core';

import type { ElectronFatalMode } from '../types';

type FatalOptions = {
    uncaughtExceptionMode: ElectronFatalMode;
    unhandledRejectionMode: ElectronFatalMode;
    shutdownTimeoutMs: number;
};

/**
 * Fatal callbacks for Electron main. Mirrors @flareapp/node's buildFatalCallbacks but exits via
 * the injected `exit` (defaulting to app.exit at the call site), which is immediate and skips
 * before-quit/will-quit, correct after an uncaught exception.
 */
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
            // Only drain other in-flight reports when we're about to exit. In
            // 'report' mode the process keeps running, so those reports settle
            // on their own and flushing here would just waste time. Mirrors
            // onRejection.
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

/**
 * Owns the lifecycle of the two process-level error listeners for the Electron main process.
 * Mirrors node's ProcessHandlerManager. Attach/detach the two process listeners, reconciling
 * against the desired modes.
 */
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
        if (wants && !current) {
            set(impl);
            process.on(event, impl as any);
        } else if (!wants && current) {
            process.off(event, current as any);
            set(null);
        }
    }
}
