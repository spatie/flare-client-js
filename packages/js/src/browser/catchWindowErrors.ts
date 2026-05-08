// Wires up global `error` and `unhandledrejection` listeners. Reports are routed through
// `window.flare`, which the host app must assign (see Flare.light()/configure()). If the global
// is not present (e.g. flare not initialised yet), events are silently dropped rather than queued.

type WindowFlare = {
    report: (e: Error) => unknown;
    reportUnhandledRejection: (message: string) => unknown;
};

export function catchWindowErrors() {
    if (typeof window === 'undefined') {
        return;
    }

    window.addEventListener('error', (event: ErrorEvent) => {
        const flare = (window as unknown as { flare?: WindowFlare }).flare;
        if (!flare) return;
        // ErrorEvent.error is null for cross-origin script errors ("Script error."), skip those.
        if (event.error instanceof Error) {
            Promise.resolve(flare.report(event.error)).catch(() => {});
        }
    });

    window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
        const flare = (window as unknown as { flare?: WindowFlare }).flare;
        if (!flare) return;

        const reason = event.reason;
        if (reason instanceof Error) {
            Promise.resolve(flare.report(reason)).catch(() => {});
            return;
        }

        if (hasStack(reason)) {
            const error = new Error(describeRejectionReason(reason));
            error.stack = (reason as { stack: string }).stack;
            Promise.resolve(flare.report(error)).catch(() => {});
            return;
        }

        Promise.resolve(flare.reportUnhandledRejection(describeRejectionReason(reason))).catch(() => {});
    });
}

function describeRejectionReason(reason: unknown): string {
    if (typeof reason === 'string') return reason;
    if (reason && typeof reason === 'object') {
        const message = (reason as { message?: unknown }).message;
        if (typeof message === 'string') return message;
        try {
            return JSON.stringify(reason);
        } catch {
            return 'Unhandled promise rejection (non-serializable reason)';
        }
    }
    return String(reason);
}

function hasStack(value: unknown): boolean {
    return (
        typeof value === 'object' &&
        value !== null &&
        'stack' in value &&
        typeof (value as Record<string, unknown>).stack === 'string'
    );
}
