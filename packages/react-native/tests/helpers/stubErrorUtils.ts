import { vi } from 'vitest';

type Handler = (error: unknown, isFatal?: boolean) => void;

type StubbedErrorUtils = {
    emit: (error: unknown, isFatal?: boolean) => void;
    current: () => Handler | undefined;
};

/**
 * Stub RN's `ErrorUtils` global, optionally seeded with an initial handler. Returns `emit` (fire the
 * currently-registered handler) and `current` (read it). Uses `vi.stubGlobal`, so a suite-level
 * `vi.unstubAllGlobals()` puts it back; the stub does not outlive its test.
 */
export function stubErrorUtils(initial?: Handler): StubbedErrorUtils {
    let current: Handler | undefined = initial;
    vi.stubGlobal('ErrorUtils', {
        getGlobalHandler: () => current,
        setGlobalHandler: (cb: Handler) => {
            current = cb;
        },
    });
    return {
        emit: (error: unknown, isFatal?: boolean) => current?.(error, isFatal),
        current: () => current,
    };
}
