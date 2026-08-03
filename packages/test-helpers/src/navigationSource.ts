import { vi } from 'vitest';

export type FakeNavigationSource = {
    startNavigation: ReturnType<typeof vi.fn>;
    setActiveRouteName: ReturnType<typeof vi.fn>;
    settleNavigation: ReturnType<typeof vi.fn>;
    unregister: ReturnType<typeof vi.fn>;
};

/** The `browserSeamMock` return shape: the real module's exports, plus a known, typed registration spy. */
export type BrowserSeamMock = Record<string, unknown> & { registerNavigationSource: ReturnType<typeof vi.fn> };

/**
 * The `@flareapp/js/browser` mock used by every nav-seam suite. Only the seam itself is faked; pass
 * the real module as `original` and everything else stays real, so a suite cannot pass against a
 * hand-written stand-in that has drifted from the code it stands in for.
 *
 * Call it with vitest's `importOriginal`:
 *
 *     vi.mock('@flareapp/js/browser', async (importOriginal) =>
 *         (await import('@flareapp/test-helpers')).browserSeamMock(nav, await importOriginal()));
 *
 * Pass a hoisted spy as the third argument when a test needs registration itself assertable, not
 * just what the returned handle is used for:
 *
 *     const registerNavigationSource = vi.hoisted(() => vi.fn(() => nav));
 *     vi.mock('@flareapp/js/browser', async (importOriginal) =>
 *         (await import('@flareapp/test-helpers')).browserSeamMock(nav, await importOriginal(), registerNavigationSource));
 */
export function browserSeamMock(
    nav: FakeNavigationSource,
    original: Record<string, unknown>,
    registerNavigationSource: ReturnType<typeof vi.fn> = vi.fn(() => nav),
): BrowserSeamMock {
    return { ...original, registerNavigationSource };
}

/**
 * A standalone `@flareapp/js/browser` stand-in, for tests about what a module does NOT import. Unlike
 * `browserSeamMock` it does not spread the real module, so importing it pulls in nothing: that is the
 * whole point, and it is also why every other suite should use `browserSeamMock` instead.
 *
 *     vi.doMock('@flareapp/js/browser', () => browserSeamStub());
 */
export function browserSeamStub(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const absoluteUrl = (href: string | null | undefined): URL | undefined => {
        if (href == null) {
            return undefined;
        }
        try {
            return new URL(href, window.location.href);
        } catch {
            return undefined;
        }
    };

    return {
        registerNavigationSource: () => ({
            startNavigation() {},
            setActiveRouteName() {},
            settleNavigation() {},
            unregister() {},
        }),
        insulate: (fn: (...a: unknown[]) => void) => fn,
        safeInvoke: (fn?: () => void) => fn?.(),
        absoluteUrl,
        absoluteHref: (href: string | null | undefined) => absoluteUrl(href)?.href,
        ...overrides,
    };
}
