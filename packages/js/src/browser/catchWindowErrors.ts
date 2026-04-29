export function catchWindowErrors() {
    if (typeof window === 'undefined') {
        return;
    }

    // @ts-ignore
    const flare = window.flare;

    if (!window || !flare) {
        return;
    }

    window.addEventListener('error', (event: ErrorEvent) => {
        if (event.error) {
            flare.report(event.error);
        }
    });

    window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
        const reason = event.reason;

        if (reason instanceof Error) {
            flare.report(reason);
            return;
        }

        const message = typeof reason === 'string' ? reason : safeStringify(reason);
        flare.report(new Error(message));
    });
}

function safeStringify(value: unknown): string {
    try {
        return JSON.stringify(value) ?? String(value);
    } catch {
        return String(value);
    }
}
