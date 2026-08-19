import { describe, expect, it } from 'vitest';

import { createComponentMatcher } from '../src/util/componentMatcher';

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

    // A `g` or `y` regex carries lastIndex between calls, so reusing the caller's object would make
    // every other test() miss. This is the whole reason the function copies the pattern.
    it('does not let a sticky or global regex miss on alternate calls', () => {
        const matches = createComponentMatcher([/Page/g]);

        expect(matches('ProductPage')).toBe(true);
        expect(matches('ProductPage')).toBe(true);
        expect(matches('CartPage')).toBe(true);
    });

    it("does not mutate the caller's regex", () => {
        const pattern = /Page/g;
        createComponentMatcher([pattern])('ProductPage');

        expect(pattern.lastIndex).toBe(0);
    });
});
