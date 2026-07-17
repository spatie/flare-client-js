import { vi } from 'vitest';

export type FakeNavigationSource = {
    startNavigation: ReturnType<typeof vi.fn>;
    setActiveRouteName: ReturnType<typeof vi.fn>;
    settleNavigation: ReturnType<typeof vi.fn>;
    unregister: ReturnType<typeof vi.fn>;
};

/**
 * The `@flareapp/js/browser` mock used by every nav-seam suite. Only the seam itself is faked; pass
 * the real module as `original` and everything else stays real, so a suite cannot pass against a
 * hand-written stand-in that has drifted from the code it stands in for.
 *
 * Call it with vitest's `importOriginal`:
 *
 *     vi.mock('@flareapp/js/browser', async (importOriginal) =>
 *         (await import('@flareapp/test-helpers')).browserSeamMock(nav, await importOriginal()));
 */
export function browserSeamMock(nav: FakeNavigationSource, original: Record<string, unknown>) {
    return {
        ...original,
        registerNavigationSource: vi.fn(() => nav),
    };
}
