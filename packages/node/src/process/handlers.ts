import type { FatalMode } from '../types';

type Callbacks = {
    onUncaught: (err: unknown, origin: string) => void;
    onRejection: (reason: unknown) => void;
};

/**
 * Owns the lifecycle of the `uncaughtException` and `unhandledRejection` process listeners that feed
 * fatal failures to Flare.
 *
 * 1. `reconcile(...)` makes listener attachment match the current `FatalMode` per event (attach when
 *    wanted-but-absent, detach when unwanted-but-present, else no-op). Idempotent.
 * 2. `detach()` removes both listeners regardless of intent, for tests and graceful shutdown.
 *
 * Kept separate from `NodeFlare` because it's pure `process`-event plumbing with no Flare semantics,
 * which keeps it trivially testable.
 */
export class ProcessHandlerManager {
    /** The currently-attached listener for `uncaughtException`, or `null`. */
    private uncaughtHandler: ((err: unknown, origin: string) => void) | null = null;
    /** The currently-attached listener for `unhandledRejection`, or `null`. */
    private rejectionHandler: ((reason: unknown) => void) | null = null;

    constructor(private cbs: Callbacks) {}

    /**
     * Bring the attached listeners into agreement with the supplied modes.
     * Idempotent: when current state already matches intent, this is a no-op.
     */
    reconcile(opts: { uncaughtExceptionMode: FatalMode; unhandledRejectionMode: FatalMode }): void {
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

    /**
     * Remove both listeners regardless of current intent. Used by tests and by
     * `NodeFlare.removeProcessListeners()`. Safe to call when nothing is
     * attached.
     */
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

    /**
     * Generic attach/detach for one event. The `get`/`set` closures share this body across both events
     * while mutating distinct fields (`uncaughtHandler` vs `rejectionHandler`). Attaches when wanted and
     * absent, detaches when unwanted and present, else no-op.
     */
    private reconcileOne(
        event: 'uncaughtException' | 'unhandledRejection',
        mode: FatalMode,
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
