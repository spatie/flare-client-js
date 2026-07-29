import { describe, expect, it } from 'vitest';

import { resolveProfileName } from '../src/resolveProfileName.js';

describe('resolveProfileName', () => {
    it('uses the bare basename for an ordinary component', () => {
        expect(resolveProfileName('/app/src/lib/ProductGallery.svelte')).toBe('ProductGallery');
    });

    it('leaves a root route file as its bare name', () => {
        expect(resolveProfileName('/app/src/routes/+page.svelte')).toBe('+page');
    });

    it('prefixes a nested route file with its route directory', () => {
        expect(resolveProfileName('/app/src/routes/product/[id]/+page.svelte')).toBe('product/[id]/+page');
    });

    it('prefixes a nested layout the same way', () => {
        expect(resolveProfileName('/app/src/routes/product/+layout.svelte')).toBe('product/+layout');
    });

    it('honors a custom routesDir', () => {
        expect(resolveProfileName('/app/source/pages/cart/+page.svelte', 'source/pages')).toBe('cart/+page');
    });

    // A `+` file that is not under the routes dir has no route path to borrow.
    it('falls back to the basename for a + file outside the routes dir', () => {
        expect(resolveProfileName('/app/src/lib/+weird.svelte')).toBe('+weird');
    });

    it('normalizes Windows separators', () => {
        expect(resolveProfileName('C:\\app\\src\\routes\\product\\[id]\\+page.svelte')).toBe('product/[id]/+page');
    });

    // A project checked out into a directory that itself contains `src/routes` must anchor on the last
    // occurrence, not the first.
    it('anchors on the last routes segment', () => {
        expect(resolveProfileName('/home/src/routes/app/src/routes/cart/+page.svelte')).toBe('cart/+page');
    });

    it('handles a project-relative filename', () => {
        expect(resolveProfileName('src/routes/cart/+page.svelte')).toBe('cart/+page');
    });

    // `kit.files.routes` is resolved by SvelteKit with path.resolve, so `./src/routes` and
    // `src/routes/` are both legal things for a user to write. Neither may drop the route prefix.
    it('tolerates a routesDir written with a leading ./ or a trailing slash', () => {
        expect(resolveProfileName('/app/src/routes/cart/+page.svelte', './src/routes')).toBe('cart/+page');
        expect(resolveProfileName('/app/src/routes/cart/+page.svelte', 'src/routes/')).toBe('cart/+page');
    });

    it('keeps route groups in the name', () => {
        expect(resolveProfileName('/app/src/routes/(marketing)/about/+page.svelte')).toBe('(marketing)/about/+page');
    });
});
