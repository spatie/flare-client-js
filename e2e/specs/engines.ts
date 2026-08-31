// Per-engine expectations for the cross-engine projects, kept in one place instead of
// conditionals sprinkled through assertions.

// Reported by every engine. Measured 2026-08-11 on Chromium, Firefox 150.0.2 and WebKit 26.4.
export const UNIVERSAL_VITALS = ['ttfb', 'fcp', 'lcp', 'inp'] as const;

// Firefox and WebKit have no layout-shift observer, so CLS never arrives there. If a future
// Playwright build adds one, this test fails because the engine gained support, not because the
// client broke — update this list, don't chase a client bug.
export const CHROMIUM_ONLY_VITALS = ['cls'] as const;

export const expectedVitals = (browserName: string): string[] =>
    browserName === 'chromium' ? [...UNIVERSAL_VITALS, ...CHROMIUM_ONLY_VITALS] : [...UNIVERSAL_VITALS];
