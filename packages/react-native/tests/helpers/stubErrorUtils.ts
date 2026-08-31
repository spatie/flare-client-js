import { vi } from 'vitest';

type Handler = (error: unknown, isFatal?: boolean) => void;

type StubbedErrorUtils = {
    emit: (error: unknown, isFatal?: boolean) => void;
    current: () => Handler | undefined;
};

// Stubs RN's `ErrorUtils` global, optionally seeded with an initial handler. Uses `vi.stubGlobal`, so
// `vi.unstubAllGlobals()` in an afterEach cleans it up.
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
