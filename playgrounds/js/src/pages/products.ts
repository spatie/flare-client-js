import { products, unsplashUrl } from '@flareapp/playgrounds-shared';

import { renderLayout } from '../layout';
import type { RouteHandler } from '../router';
import { cart } from '../state';

export const renderProducts: RouteHandler = (_match, root) => {
    const grid = products
        .map(
            (product) => `
            <article class="group rounded-2xl bg-surface border border-surface-border overflow-hidden" data-testid="product-card-${product.id}">
                <a data-link href="/product/${product.id}" class="block">
                    <img src="${unsplashUrl(product.unsplashId, 400, 400)}" alt="${product.title}" class="aspect-square w-full object-cover" loading="lazy" />
                </a>
                <div class="p-4 flex items-center justify-between gap-3">
                    <div>
                        <h2 class="text-sm font-semibold">${product.title}</h2>
                        <p class="text-xs opacity-70">${product.photographer}</p>
                    </div>
                    <div class="text-sm font-mono">$${(product.priceCents / 100).toFixed(2)}</div>
                </div>
                <div class="px-4 pb-4">
                    <button data-product-id="${product.id}" data-testid="add-to-cart-${product.id}" class="w-full rounded-lg bg-brand-ink text-white text-sm py-2 hover:opacity-90">Add to cart</button>
                </div>
            </article>
        `
        )
        .join('');

    renderLayout(
        root,
        `<section data-testid="product-grid">
            <h1 class="text-xl font-semibold mb-6">Photographs</h1>
            <div class="grid grid-cols-2 md:grid-cols-3 gap-6">${grid}</div>
        </section>`
    );

    root.querySelectorAll<HTMLButtonElement>('button[data-product-id]').forEach((button) => {
        button.addEventListener('click', () => cart.add(button.dataset.productId ?? ''));
    });
};
