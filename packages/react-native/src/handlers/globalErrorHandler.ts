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
 * Wrap RN's `ErrorUtils` global handler. The wrapper reports the error then delegates to the previous
 * handler, preserving RN's own behavior (red box in dev, crash in prod): observe, don't swallow. No-op
 * when `ErrorUtils` is absent.
 *
 * Fatal delivery (`onFatal`): on a fatal error in production, the previous handler tears the app down and
 * our report is an async `fetch` the OS kills the instant the app dies, so a bare report rarely sends. When
 * `onFatal` is supplied we defer the previous handler until it settles, draining the transport via core's
 * `flush(timeoutMs)` first. Skipped in `__DEV__` (don't fight the red box / debugger) and guarded by a
 * re-entrancy latch, so a second fatal arriving mid-flush delegates immediately rather than racing two
 * shutdowns. Mirrors Sentry's RN SDK.
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
            // Reporting must never block RN's own error handling below.
        }

        if (isFatal && onFatal && !inDevMode() && !handlingFatal) {
            handlingFatal = true;
            void onFatal()
                .catch(() => {})
                .then(() => {
                    // Delegate to the crash-triggering handler with the latch still set, then clear it. In
                    // production `previous` tears the app down so the latch never reopens; if `previous`
                    // returns (dev/test), a fatal during it delegates immediately, not a second flush cycle.
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
        // No ErrorUtils API clears a handler, so with no previous one we restore a swallowing no-op. RN
        // always installs a default handler, so `previous` is effectively never undefined.
        errorUtils.setGlobalHandler(previous ?? (() => {}));
    };
}
