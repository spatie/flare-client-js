export function catchWindowErrors() {
    if (typeof window === 'undefined') {
        return;
    }

    window.addEventListener('error', (event: ErrorEvent) => {
        const flare = (window as unknown as { flare?: { report: (e: Error) => unknown } }).flare;
        if (!flare) return;
        if (event.error instanceof Error) {
            flare.report(event.error);
        }
    });

    window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
        const flare = (window as unknown as { flare?: { report: (e: Error) => unknown } }).flare;
        if (!flare) return;

        const reason = event.reason;
        if (reason instanceof Error) {
            flare.report(reason);
            return;
        }

        flare.report(new Error(describeRejectionReason(reason)));
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
