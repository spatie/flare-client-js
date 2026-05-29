import type { FatalMode } from '../types';

type Callbacks = {
    onUncaught: (err: unknown, origin: string) => void;
    onRejection: (reason: unknown) => void;
};

/**
 * Owns the lifecycle of the two process-level error listeners that capture
 * fatal failures and feed them to Flare:
 *
 * - `process.on('uncaughtException', ...)`
 * - `process.on('unhandledRejection', ...)`
 *
 * The manager has two responsibilities:
 *
 * 1. **Reconcile listener state with intent.** Given the current `FatalMode`
 *    for each event (`'off' | 'report' | 'report-and-exit'`), make the actual
 *    listener attachment match: attach when it should be attached but isn't,
 *    detach when it shouldn't be attached but is, no-op when already in the
 *    desired state. This is idempotent — calling `reconcile(...)` repeatedly
 *    with the same options is safe.
 * 2. **Tear down on demand.** `detach()` removes both listeners regardless of
 *    intent, for tests and graceful shutdown.
 *
 * Why keep this separate from `NodeFlare`: the attach/detach logic is purely
 * about Node `process` events and contains no Flare semantics. Isolating it
 * makes it trivial to test (the test suite drives `reconcile()` directly with
 * stub callbacks and asserts on `process.listeners(...)`) and keeps
 * `NodeFlare` focused on report assembly + user-facing API.
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
     * Generic attach/detach for one event. The `get`/`set` closures let us
     * share this body between the two events while still mutating distinct
     * fields (`uncaughtHandler` vs `rejectionHandler`).
     *
     * Truth table:
     * - intent off, currently attached -> detach
     * - intent off, not attached       -> no-op
     * - intent on,  currently attached -> no-op (already correct)
     * - intent on,  not attached       -> attach
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
