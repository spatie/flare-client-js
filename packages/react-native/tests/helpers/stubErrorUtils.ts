type Handler = (error: unknown, isFatal?: boolean) => void;

/**
 * Stub RN's `ErrorUtils` global, optionally seeded with an initial handler. Returns `emit` (fire the
 * currently-registered handler) and `current` (read it).
 */
export function stubErrorUtils(initial?: Handler) {
    let current: Handler | undefined = initial;
    (globalThis as Record<string, unknown>).ErrorUtils = {
        getGlobalHandler: () => current,
        setGlobalHandler: (cb: Handler) => {
            current = cb;
        },
    };
    return {
        emit: (error: unknown, isFatal?: boolean) => current?.(error, isFatal),
        current: () => current,
    };
}
