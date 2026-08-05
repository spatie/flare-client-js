import { formatMoney, journeyGlows, recordGlow, shopApi, unsplashUrl } from '@flareapp/playgrounds-shared';

import { flare } from '../flare';
import { renderLayout } from '../layout';
import type { RouteHandler } from '../router';
import { cart } from '../state';

export const renderProduct: RouteHandler = async (match, root) => {
    const [detail, recommended] = await Promise.all([
        shopApi.product(match.params.id).catch(() => null),
        shopApi.recommendations(match.params.id),
    ]);

    if (!detail) {
        renderLayout(root, `<p>Product not found.</p>`);
        return;
    }

    const { product, description } = detail;
    recordGlow(flare, journeyGlows.viewedProduct(product));

    const alsoLike = recommended
        .map(
            (other) => `<a data-link href="/product/${other.id}" class="text-brand hover:underline">${other.title}</a>`,
        )
        .join(' · ');

    renderLayout(
        root,
        `<article class="grid md:grid-cols-2 gap-8">
            <img src="${unsplashUrl(product.unsplashId, 800, 800)}" alt="${product.title}" class="aspect-square w-full object-cover rounded-2xl" />
            <div class="flex flex-col gap-4">
                <h1 class="text-2xl font-semibold">${product.title}</h1>
                <p class="text-sm opacity-70">Photograph by ${product.photographer}</p>
                <p class="text-sm opacity-70">${description}</p>
                <div class="text-xl font-mono">${formatMoney(product.price)}</div>
                <button data-action="add" data-testid="add-to-cart-${product.id}" class="rounded-lg bg-brand-ink text-white py-3 hover:opacity-90">Add to cart</button>
                <button data-action="broken-solution" class="rounded-lg border border-brand text-brand py-3 hover:bg-brand-soft">Trigger broken solution</button>
                <p class="text-xs opacity-60">Also like: ${alsoLike}</p>
            </div>
        </article>`,
    );

    root.querySelector<HTMLButtonElement>('[data-action="add"]')?.addEventListener('click', () => {
        cart.add(product.id);
        recordGlow(flare, journeyGlows.addedToCart(product.id, cart.count()));
    });

    root.querySelector<HTMLButtonElement>('[data-action="broken-solution"]')?.addEventListener('click', () => {
        void flare.report(new Error(`broken-solution:${product.id}`), {
            'context.product': { id: product.id, title: product.title },
        });
    });
};
