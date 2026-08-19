// Per-engine expectations for the cross-engine projects. One place, so an engine difference is a data
// change here rather than a conditional sprinkled through assertions.

/** Reported by every engine. Measured 2026-08-11 on Chromium, Firefox 150.0.2 and WebKit 26.4. */
export const UNIVERSAL_VITALS = ['ttfb', 'fcp', 'lcp', 'inp'] as const;

/**
 * Firefox and WebKit implement no layout-shift observer, so CLS never arrives there. This pins the
 * browser builds Playwright ships today. If a future Playwright Firefox or WebKit build adds a
 * layout-shift observer, this test starts failing because the engine gained support, not because the
 * client broke — update this list, don't go hunting for a client bug.
 */
export const CHROMIUM_ONLY_VITALS = ['cls'] as const;

export const expectedVitals = (browserName: string): string[] =>
    browserName === 'chromium' ? [...UNIVERSAL_VITALS, ...CHROMIUM_ONLY_VITALS] : [...UNIVERSAL_VITALS];
