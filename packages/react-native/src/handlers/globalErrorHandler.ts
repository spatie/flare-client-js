import { convertToError } from '@flareapp/core';

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
 * calls the previously-registered handler, so React Native's own behavior (red
 * box in dev, process crash in prod) is preserved — we observe, we do not
 * swallow. No-op when `ErrorUtils` is unavailable.
 *
 * Returns an uninstaller that restores the previous handler.
 */
export function installGlobalErrorHandler(report: (error: Error, isFatal: boolean) => void): () => void {
    const errorUtils = getErrorUtils();
    if (!errorUtils) return () => {};

    const previous = errorUtils.getGlobalHandler();

    const handler: GlobalErrorHandler = (error, isFatal) => {
        try {
            report(convertToError(error), Boolean(isFatal));
        } finally {
            previous?.(error, isFatal);
        }
    };

    errorUtils.setGlobalHandler(handler);

    return () => {
        errorUtils.setGlobalHandler(previous ?? (() => {}));
    };
}
