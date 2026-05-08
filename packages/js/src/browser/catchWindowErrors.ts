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

        if (hasStack(reason)) {
            const error = new Error(rejectionReasonToMessage(reason));
            error.stack = (reason as { stack: string }).stack;
            flare.report(error);
            return;
        }

        flare.reportMessage(rejectionReasonToMessage(reason), {}, 'UnhandledPromiseRejection');
    });
}

function rejectionReasonToMessage(reason: unknown): string {
    if (typeof reason === 'string') {
        return reason;
    }

    if (reason == null) {
        return `Unhandled promise rejection (${reason})`;
    }

    if (typeof reason === 'object') {
        if ('message' in reason && typeof (reason as Record<string, unknown>).message === 'string') {
            return (reason as Record<string, unknown>).message as string;
        }

        try {
            const json = JSON.stringify(reason);
            if (json && json !== '{}') {
                return `Unhandled promise rejection: ${json}`;
            }
        } catch {}

        return 'Unhandled promise rejection with non-serializable object';
    }

    return `Unhandled promise rejection: ${String(reason)}`;
}

function hasStack(value: unknown): boolean {
    return (
        typeof value === 'object' &&
        value !== null &&
        'stack' in value &&
        typeof (value as Record<string, unknown>).stack === 'string'
    );
}
