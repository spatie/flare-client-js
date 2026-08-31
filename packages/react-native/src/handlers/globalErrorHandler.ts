import { convertToError } from '@flareapp/core';

import { inDevMode } from '../devMode';

type GlobalErrorHandler = (error: unknown, isFatal?: boolean) => void;

type ErrorUtilsLike = {
    getGlobalHandler: () => GlobalErrorHandler | undefined;
    setGlobalHandler: (callback: GlobalErrorHandler) => void;
};

function getErrorUtils(): ErrorUtilsLike | undefined {
    return (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
}

// Wraps RN's `ErrorUtils` handler: reports the error, then delegates to the previous handler so RN's own
// behavior (red box in dev, crash in prod) still happens.
//
// `onFatal` delays the previous handler until the transport drains, since a production fatal otherwise
// tears the app down before the async report can send. Skipped in dev (would fight the red box); only
// runs once so a second fatal mid-flush hands over immediately. Mirrors Sentry's RN SDK.
export function installGlobalErrorHandler(
    report: (error: Error, isFatal: boolean) => void,
    onFatal?: () => Promise<void>,
): () => void {
    const errorUtils = getErrorUtils();
    if (!errorUtils) {
        return () => {};
    }

    const previous = errorUtils.getGlobalHandler();
    let handlingFatal = false;

    const handler: GlobalErrorHandler = (error, isFatal) => {
        try {
            report(convertToError(error), Boolean(isFatal));
        } catch {
            // Reporting must never block RN's own error handling below.
        }

        if (isFatal && onFatal && !inDevMode() && !handlingFatal) {
            handlingFatal = true;
            void onFatal()
                .catch(() => {})
                .then(() => {
                    // `previous` usually tears the app down, so this flag is never cleared. If it does
                    // return, a fatal raised during handoff hands over immediately instead of restarting.
                    try {
                        previous?.(error, isFatal);
                    } finally {
                        handlingFatal = false;
                    }
                });
            return;
        }

        previous?.(error, isFatal);
    };

    errorUtils.setGlobalHandler(handler);

    return () => {
        // No API clears a handler, so fall back to a no-op if there's no previous one. RN always installs
        // a default handler, so this is mostly theoretical.
        errorUtils.setGlobalHandler(previous ?? (() => {}));
    };
}
