import { vi } from 'vitest';

export type FakeNavigationSource = {
    startNavigation: ReturnType<typeof vi.fn>;
    setActiveRouteName: ReturnType<typeof vi.fn>;
    settleNavigation: ReturnType<typeof vi.fn>;
    unregister: ReturnType<typeof vi.fn>;
};

/**
 * The `@flareapp/js/browser` mock factory used by every nav-seam suite: the seam plus the two
 * instrumentation guards, which swallow throws exactly as the real ones do.
 */
export function browserSeamMock(nav: FakeNavigationSource) {
    return {
        registerNavigationSource: vi.fn(() => nav),
        insulate:
            (fn: (...a: unknown[]) => void) =>
            (...a: unknown[]) => {
                try {
                    fn(...a);
                } catch {
                    /* swallow */
                }
            },
        safeInvoke: (fn?: (() => void) | null) => {
            try {
                fn?.();
            } catch {
                /* swallow */
            }
        },
    };
}
