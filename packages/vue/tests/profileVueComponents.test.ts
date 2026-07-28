import { describe, expect, it } from 'vitest';

import { createComponentMatcher } from '../src/profileVueComponents';

describe('createComponentMatcher', () => {
    it('matches nothing when profiling is off', () => {
        expect(createComponentMatcher(false)('ProductPage')).toBe(false);
    });

    it('matches everything when profiling is on', () => {
        expect(createComponentMatcher(true)('ProductPage')).toBe(true);
        expect(createComponentMatcher(true)('AnonymousComponent')).toBe(true);
    });

    it('matches strings exactly', () => {
        const matches = createComponentMatcher(['ProductPage']);

        expect(matches('ProductPage')).toBe(true);
        expect(matches('ProductPageHeader')).toBe(false);
        expect(matches('productpage')).toBe(false);
    });

    it('matches regexes by test', () => {
        const matches = createComponentMatcher([/^Product/]);

        expect(matches('ProductPage')).toBe(true);
        expect(matches('ProductGallery')).toBe(true);
        expect(matches('CartPage')).toBe(false);
    });

    it('accepts a mixed array', () => {
        const matches = createComponentMatcher(['CartPage', /^Product/]);

        expect(matches('CartPage')).toBe(true);
        expect(matches('ProductPage')).toBe(true);
        expect(matches('CheckoutPage')).toBe(false);
    });

    it('matches nothing for an empty array', () => {
        expect(createComponentMatcher([])('ProductPage')).toBe(false);
    });

    it('is not confused by a global regex used repeatedly', () => {
        // A `g` or `y` regex advances lastIndex on every test(), so the second call on the same
        // matcher would miss. The matcher strips those flags when it is built.
        const matches = createComponentMatcher([/Page/g]);

        expect(matches('ProductPage')).toBe(true);
        expect(matches('ProductPage')).toBe(true);
        expect(matches('CartPage')).toBe(true);
    });
});
