import type { ApiProduct } from '@flareapp/playgrounds-shared';
import { formatMoney, journeyGlows, recordGlow, shopApi, testIds, unsplashUrl } from '@flareapp/playgrounds-shared';
import { cart, useAsyncData } from '@flareapp/playgrounds-shared/react';
import { withFlareProfiler } from '@flareapp/react/profiler';
import { createRoute, Link } from '@tanstack/react-router';

import { flare } from '../flare';
import { rootRoute } from './__root';

const ProductCard = withFlareProfiler(
    ({ product }: { product: ApiProduct }) => (
        <article
            data-testid={testIds.productCard(product.id)}
            className="group rounded-2xl bg-surface border border-surface-border overflow-hidden"
        >
            <Link to="/product/$id" params={{ id: product.id }} className="block">
                <img
                    src={unsplashUrl(product.unsplashId, 400, 400)}
                    alt={product.title}
                    loading="lazy"
                    className="aspect-square w-full object-cover"
                />
            </Link>
            <div className="p-4 flex items-center justify-between gap-3">
                <div>
                    <h2 className="text-sm font-semibold">{product.title}</h2>
                    <p className="text-xs opacity-70">{product.photographer}</p>
                </div>
                <div className="text-sm font-mono">{formatMoney(product.price)}</div>
            </div>
            <div className="px-4 pb-4">
                <button
                    type="button"
                    data-testid={testIds.addToCart(product.id)}
                    onClick={() => {
                        cart.add(product.id);
                        recordGlow(flare, journeyGlows.addedToCart(product.id, cart.count()));
                    }}
                    className="w-full rounded-lg bg-brand-ink text-white text-sm py-2 hover:opacity-90"
                >
                    Add to cart
                </button>
            </div>
        </article>
    ),
    { name: 'ProductCard' },
);

const ProductGrid = withFlareProfiler(
    ({ products }: { products: ApiProduct[] }) => (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
            {products.map((product) => (
                <ProductCard key={product.id} product={product} />
            ))}
        </div>
    ),
    { name: 'ProductGrid' },
);

const ProductsPage = () => {
    // Three parallel requests, so the page load span has a waterfall under it rather than one bar.
    const data = useAsyncData(
        () =>
            Promise.all([shopApi.products(), shopApi.recommendations(), shopApi.cartSummary(cart.lines())]).then(
                ([products, recommended, summary]) => ({ products, recommended, summary }),
            ),
        'products-page',
    );

    return (
        <section data-testid={testIds.productGrid}>
            <h1 className="text-xl font-semibold mb-6">Photographs</h1>
            {data ? <ProductGrid products={data.products} /> : <p className="text-sm opacity-60">Loading catalog…</p>}
            {data ? (
                <>
                    <h2 className="text-sm font-semibold mt-10 mb-3">Picked for you</h2>
                    <div className="flex flex-wrap gap-3">
                        {data.recommended.map((product) => (
                            <Link
                                key={product.id}
                                to="/product/$id"
                                params={{ id: product.id }}
                                className="rounded-xl border border-surface-border bg-surface px-4 py-3 text-sm"
                            >
                                {product.title}{' '}
                                <span className="opacity-60 font-mono">{formatMoney(product.price)}</span>
                            </Link>
                        ))}
                    </div>
                    <p className="mt-6 text-xs opacity-60">{data.summary.lines.length} line(s) in your cart</p>
                </>
            ) : null}
        </section>
    );
};

export const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: withFlareProfiler(ProductsPage, { name: 'ProductsPage' }),
});
