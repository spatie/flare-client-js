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
 * Wrap RN's `ErrorUtils` global handler. The wrapper reports the error and then
 * delegates to the previously-registered handler, so React Native's own behavior
 * (red box in dev, process crash in prod) is preserved — we observe, we do not
 * swallow. No-op when `ErrorUtils` is unavailable.
 *
 * Fatal delivery (`onFatal`). On a FATAL error in a PRODUCTION bundle the
 * previous handler is what tears the app down, and our report is an async
 * `fetch` the OS would kill the instant the app dies — so a bare report almost
 * never sends. When `onFatal` is supplied we DEFER the previous handler until
 * `onFatal()` settles; it drains the transport via core's `flush(timeoutMs)`,
 * buying the report time to send before the crash. RN does not crash on its own
 * (the default handler triggers it), so deferring the delegate genuinely delays
 * the crash. This mirrors Sentry's React Native SDK. It is skipped in `__DEV__`
 * (don't fight the red box / debugger) and guarded by a re-entrancy latch, so a
 * second fatal arriving mid-flush delegates immediately rather than racing two
 * shutdowns.
 *
 * Returns an uninstaller that restores the previous handler.
 */
export function installGlobalErrorHandler(
    report: (error: Error, isFatal: boolean) => void,
    onFatal?: () => Promise<void>,
): () => void {
    const errorUtils = getErrorUtils();
    if (!errorUtils) return () => {};

    const previous = errorUtils.getGlobalHandler();
    let handlingFatal = false;

    const handler: GlobalErrorHandler = (error, isFatal) => {
        try {
            report(convertToError(error), Boolean(isFatal));
        } catch {
            // Reporting must never prevent RN's own error handling below.
        }

        if (isFatal && onFatal && !inDevMode() && !handlingFatal) {
            handlingFatal = true;
            void onFatal()
                .catch(() => {})
                .then(() => {
                    // Delegate to the crash-triggering handler with the latch STILL
                    // set, then clear it. In production `previous` tears the app down
                    // so the latch never reopens; in a dev/test setup where `previous`
                    // returns, a fatal arriving during it still delegates immediately
                    // instead of starting a second flush cycle.
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
        // No ErrorUtils API exists to clear a handler, so when there was no
        // previous one we restore a swallowing no-op. RN always installs a
        // default handler, so `previous` is effectively never undefined.
        errorUtils.setGlobalHandler(previous ?? (() => {}));
    };
}
