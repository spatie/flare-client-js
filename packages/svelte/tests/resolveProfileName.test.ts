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

    // Nothing to borrow a route path from out here.
    it('falls back to the basename for a + file outside the routes dir', () => {
        expect(resolveProfileName('/app/src/lib/+weird.svelte')).toBe('+weird');
    });

    it('normalizes Windows separators', () => {
        expect(resolveProfileName('C:\\app\\src\\routes\\product\\[id]\\+page.svelte')).toBe('product/[id]/+page');
    });

    // A checkout path can contain `src/routes` itself, so anchor on the last one.
    it('anchors on the last routes segment', () => {
        expect(resolveProfileName('/home/src/routes/app/src/routes/cart/+page.svelte')).toBe('cart/+page');
    });

    it('handles a project-relative filename', () => {
        expect(resolveProfileName('src/routes/cart/+page.svelte')).toBe('cart/+page');
    });

    // SvelteKit path.resolve()s this, so both forms are legal to write.
    it('tolerates a routesDir written with a leading ./ or a trailing slash', () => {
        expect(resolveProfileName('/app/src/routes/cart/+page.svelte', './src/routes')).toBe('cart/+page');
        expect(resolveProfileName('/app/src/routes/cart/+page.svelte', 'src/routes/')).toBe('cart/+page');
    });

    it('keeps route groups in the name', () => {
        expect(resolveProfileName('/app/src/routes/(marketing)/about/+page.svelte')).toBe('(marketing)/about/+page');
    });
});
