// Shared by the browser `unhandledrejection` listener and the React Native rejection tracker, so a
// rejection reports identically across SDKs whatever it was rejected with.

export type RejectionReporter = {
    /** Error / stack-bearing reasons: preserve the stack. */
    reportSilently: (error: Error) => void;
    /** Stackless reasons. May return a promise; `routeRejection` swallows any rejection from it. */
    reportUnhandledRejection: (message: string) => unknown;
};

/** Best-effort human-readable description of an arbitrary rejection reason. */
export function describeRejectionReason(reason: unknown): string {
    if (typeof reason === 'string') {
        return reason;
    }
    if (reason && typeof reason === 'object') {
        const message = (reason as { message?: unknown }).message;
        // An empty `.message` tells the reader nothing, so fall through and let JSON.stringify show the shape.
        if (typeof message === 'string' && message) {
            return message;
        }
        try {
            return JSON.stringify(reason);
        } catch {
            return 'Unhandled promise rejection (non-serializable reason)';
        }
    }
    return String(reason);
}

function hasStack(reason: unknown): reason is { stack: string } {
    return !!reason && typeof reason === 'object' && typeof (reason as { stack?: unknown }).stack === 'string';
}

/**
 * Routes by whether `reason` carries a stack: stack-bearing reasons go to `reportSilently`, stackless
 * ones to `reportUnhandledRejection`. The `.catch` stops a transport failure from surfacing as a second
 * unhandled rejection. `reportSilently` is assumed async and left unwrapped, so a synchronous throw there
 * still propagates.
 */
export function routeRejection(reporter: RejectionReporter, reason: unknown): void {
    if (reason instanceof Error) {
        reporter.reportSilently(reason);
        return;
    }
    if (hasStack(reason)) {
        const error = new Error(describeRejectionReason(reason));
        error.stack = reason.stack;
        reporter.reportSilently(error);
        return;
    }
    Promise.resolve(reporter.reportUnhandledRejection(describeRejectionReason(reason))).catch(() => {});
}
