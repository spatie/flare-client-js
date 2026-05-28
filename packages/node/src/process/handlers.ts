import type { FatalMode } from '../types';

type Callbacks = {
    onUncaught: (err: unknown, origin: string) => void;
    onRejection: (reason: unknown) => void;
};

export class ProcessHandlerManager {
    private uncaughtHandler: ((err: unknown, origin: string) => void) | null = null;
    private rejectionHandler: ((reason: unknown) => void) | null = null;

    constructor(private cbs: Callbacks) {}

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
