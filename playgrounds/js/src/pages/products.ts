import type { ApiProduct } from '@flareapp/playgrounds-shared';
import { formatMoney, journeyGlows, recordGlow, shopApi, unsplashUrl } from '@flareapp/playgrounds-shared';

import { flare } from '../flare';
import { renderLayout } from '../layout';
import type { RouteHandler } from '../router';
import { cart } from '../state';

const card = (product: ApiProduct): string => `
    <article class="group rounded-2xl bg-surface border border-surface-border overflow-hidden" data-testid="product-card-${product.id}">
        <a data-link href="/product/${product.id}" class="block">
            <img src="${unsplashUrl(product.unsplashId, 400, 400)}" alt="${product.title}" class="aspect-square w-full object-cover" loading="lazy" />
        </a>
        <div class="p-4 flex items-center justify-between gap-3">
            <div>
                <h2 class="text-sm font-semibold">${product.title}</h2>
                <p class="text-xs opacity-70">${product.photographer}</p>
            </div>
            <div class="text-sm font-mono">${formatMoney(product.price)}</div>
        </div>
        <div class="px-4 pb-4">
            <button data-product-id="${product.id}" data-testid="add-to-cart-${product.id}" class="w-full rounded-lg bg-brand-ink text-white text-sm py-2 hover:opacity-90">Add to cart</button>
        </div>
    </article>
`;

export const renderProducts: RouteHandler = async (_match, root) => {
    // Three requests in parallel, so the page load span has a waterfall under it rather than one bar.
    const [products, recommended, summary] = await Promise.all([
        shopApi.products(),
        shopApi.recommendations(),
        shopApi.cartSummary(cart.lines()),
    ]);

    const highlights = recommended
        .map(
            (product) => `
            <a data-link href="/product/${product.id}" class="rounded-xl border border-surface-border bg-surface px-4 py-3 text-sm">
                ${product.title} <span class="opacity-60 font-mono">${formatMoney(product.price)}</span>
            </a>`,
        )
        .join('');

    renderLayout(
        root,
        `<section data-testid="product-grid">
            <h1 class="text-xl font-semibold mb-6">Photographs</h1>
            <div class="grid grid-cols-2 md:grid-cols-3 gap-6">${products.map(card).join('')}</div>
            <h2 class="text-sm font-semibold mt-10 mb-3">Picked for you</h2>
            <div class="flex flex-wrap gap-3">${highlights}</div>
            <p class="mt-6 text-xs opacity-60">${summary.lines.length} line(s) in your cart</p>
        </section>`,
    );

    root.querySelectorAll<HTMLButtonElement>('button[data-product-id]').forEach((button) => {
        button.addEventListener('click', () => {
            const productId = button.dataset.productId ?? '';
            cart.add(productId);
            recordGlow(flare, journeyGlows.addedToCart(productId, cart.count()));
        });
    });
};
