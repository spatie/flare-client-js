import { vi } from 'vitest';

const DEFAULT_URL_DENYLIST =
    /password|passwd|pwd|token|secret|authorization|\bauth\b|bearer|oauth|credentials?|cookie|api[-_]?key|private[-_]?key|session|csrf|xsrf|\bpin\b|\bssn\b|card[-_]?number|\bcvv\b/i;

function convertToError(error: unknown): Error {
    if (error instanceof Error) {
        return error;
    }
    if (typeof error === 'string') {
        return new Error(error);
    }
    if (typeof error === 'object' && error !== null) {
        const message = (error as Record<string, unknown>).message;
        return new Error(typeof message === 'string' ? message : String(error));
    }
    return new Error(String(error));
}

// The `@flareapp/js` surface every SvelteKit test stubs. `report` and `reportSilently` route to the
// caller's spy; the rest mirrors the real exports so the module under test can import them.
// `report` is the spy each test asserts on.
export function flareJsMock(report: (...args: unknown[]) => unknown) {
    return {
        convertToError,
        DEFAULT_URL_DENYLIST,
        // contextToAttributes imports this from @flareapp/js, so the mocked module must carry it.
        toCustomContext: (framework: string, payload: unknown) => ({ 'context.custom': { [framework]: payload } }),
        // Mirrors core's FrameworkName. Only the member identify.ts reads is stubbed.
        FrameworkName: { SvelteKit: 'sveltekit' },
        flare: {
            report: (...args: unknown[]) => report(...args),
            reportSilently: (...args: unknown[]) => report(...args),
            setSdkInfo: vi.fn(),
            setFramework: vi.fn(),
            addContext: vi.fn(),
        },
    };
}
