/**
 * Shared unhandled-rejection routing. A rejection "reason" can be anything a
 * promise was rejected with: an Error, an Error-like object carrying a `.stack`,
 * a string, or a plain object. The browser `unhandledrejection` listener
 * (`@flareapp/js`) and the React Native engine rejection tracker
 * (`@flareapp/react-native`) need the SAME routing so a report looks identical
 * across SDKs, so it lives here instead of being copy-pasted (and drifting) per
 * client.
 */

export type RejectionReporter = {
    // Error / stack-bearing reasons: preserve the stack.
    reportSilently: (error: Error) => void;
    // Stackless reasons: empty-stack `UnhandledRejection` shaping. May return a
    // promise (core's does); `routeRejection` swallows any rejection from it.
    reportUnhandledRejection: (message: string) => unknown;
};

/** Best-effort human-readable description of an arbitrary rejection reason. */
export function describeRejectionReason(reason: unknown): string {
    if (typeof reason === 'string') return reason;
    if (reason && typeof reason === 'object') {
        const message = (reason as { message?: unknown }).message;
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
 * Route a rejection reason to the reporter: an Error (or any stack-bearing
 * object) goes to `reportSilently` so the STACK survives; only a stackless
 * reason falls back to `reportUnhandledRejection` (string message, empty-stack
 * `UnhandledRejection` class). Any rejection from `reportUnhandledRejection`'s
 * returned promise is swallowed so a transport failure cannot itself surface as
 * an unhandled rejection.
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
