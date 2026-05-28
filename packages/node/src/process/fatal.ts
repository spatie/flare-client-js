import type { Flare } from '@flareapp/core';

import type { FatalMode } from '../types';

type FatalOptions = {
    uncaughtExceptionMode: FatalMode;
    unhandledRejectionMode: FatalMode;
    shutdownTimeoutMs: number;
};

export function buildFatalCallbacks(
    flare: Flare,
    getOpts: () => FatalOptions,
    exit: (code: number) => void = process.exit.bind(process),
) {
    return {
        async onUncaught(err: unknown, origin: string): Promise<void> {
            const error = err instanceof Error ? err : new Error(String(err));
            try {
                await flare.report(error, { 'process.uncaught_exception.origin': origin });
            } catch {
                // swallow
            }
            const opts = getOpts();
            await flare.flush(opts.shutdownTimeoutMs);
            if (opts.uncaughtExceptionMode === 'report-and-exit') {
                exit(1);
            }
        },
        async onRejection(reason: unknown): Promise<void> {
            const error = reason instanceof Error ? reason : new Error(String(reason));
            try {
                await flare.report(error);
            } catch {
                // swallow
            }
            const opts = getOpts();
            if (opts.unhandledRejectionMode === 'report-and-exit') {
                await flare.flush(opts.shutdownTimeoutMs);
                exit(1);
            }
        },
    };
}
