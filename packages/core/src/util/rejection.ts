/**
 * Shared unhandled-rejection routing. A rejection reason can be anything a promise rejected with: an Error, a
 * stack-bearing object, a string, or a plain object. The browser `unhandledrejection` listener (`@flareapp/js`) and the
 * React Native rejection tracker (`@flareapp/react-native`) share this routing so reports look identical across SDKs.
 */

export type RejectionReporter = {
    // Error / stack-bearing reasons: preserve the stack.
    reportSilently: (error: Error) => void;
    // Stackless reasons: empty-stack `UnhandledRejection` shaping. May return a promise (core's does);
    // `routeRejection` swallows any rejection from it.
    reportUnhandledRejection: (message: string) => unknown;
};

/** Best-effort human-readable description of an arbitrary rejection reason. */
export function describeRejectionReason(reason: unknown): string {
    if (typeof reason === 'string') return reason;
    if (reason && typeof reason === 'object') {
        const message = (reason as { message?: unknown }).message;
        // An empty `.message` carries no signal; fall through to JSON.stringify so the report shows the object's shape.
        if (typeof message === 'string' && message) return message;
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
 * Route a rejection reason: an Error (or any stack-bearing object) goes to `reportSilently` so the stack survives; a
 * stackless reason falls back to `reportUnhandledRejection` (string message, empty-stack `UnhandledRejection`). Any
 * rejection from `reportUnhandledRejection`'s promise is swallowed so a transport failure cannot itself surface as an
 * unhandled rejection. `reportSilently` is assumed async and not wrapped, so a synchronous throw there would propagate.
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
