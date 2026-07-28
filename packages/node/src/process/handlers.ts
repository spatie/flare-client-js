import type { FatalMode } from '../types';

type Callbacks = {
    onUncaught: (err: unknown, origin: string) => void;
    onRejection: (reason: unknown) => void;
};

/**
 * Owns the `uncaughtException` and `unhandledRejection` listeners that feed fatal failures to Flare.
 * Separate from `NodeFlare` because it is pure `process`-event plumbing with no Flare semantics, which
 * keeps it trivially testable.
 */
export class ProcessHandlerManager {
    private uncaughtHandler: ((err: unknown, origin: string) => void) | null = null;
    private rejectionHandler: ((reason: unknown) => void) | null = null;

    constructor(private cbs: Callbacks) {}

    /** Idempotent: a no-op when the attached listeners already match the supplied modes. */
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

    /** Remove both listeners regardless of intent. Safe when nothing is attached. */
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

        if (wants === (current !== null)) {
            return;
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
