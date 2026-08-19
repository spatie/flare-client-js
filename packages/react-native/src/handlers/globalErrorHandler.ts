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

/**
 * Wraps RN's `ErrorUtils` global handler: observe, do not swallow. The wrapper reports and then delegates
 * to the previous handler, so RN's own behaviour (red box in dev, crash in prod) is preserved.
 *
 * `onFatal` exists because a production fatal tears the app down while our report is still an async fetch
 * the OS kills, so a bare report rarely sends. With it, the previous handler is deferred until the
 * transport drains. Skipped in `__DEV__` so it does not fight the red box, and it only runs for the
 * first fatal, so a second one mid-flush hands straight over instead of starting a second shutdown.
 * Mirrors Sentry's RN SDK.
 */
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
                    // `handlingFatal` stays set while handing over. In production `previous` tears the app
                    // down so it is never cleared; where `previous` does return, a fatal raised during it
                    // hands over right away instead of starting a second flush cycle.
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
        // No ErrorUtils API clears a handler, so with no previous one restore a swallowing no-op. RN always
        // installs a default handler, so `previous` is effectively never undefined.
        errorUtils.setGlobalHandler(previous ?? (() => {}));
    };
}
