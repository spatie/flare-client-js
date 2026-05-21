import { products, testIds, unsplashUrl } from '@flareapp/playgrounds-shared';
import { createRoute, Link } from '@tanstack/react-router';

import { cart } from '../cart';
import { rootRoute } from './__root';

const ProductsPage = () => (
    <section data-testid={testIds.productGrid}>
        <h1 className="text-xl font-semibold mb-6">Photographs</h1>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
            {products.map((product) => (
                <article
                    key={product.id}
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
                        <div className="text-sm font-mono">${(product.priceCents / 100).toFixed(2)}</div>
                    </div>
                    <div className="px-4 pb-4">
                        <button
                            type="button"
                            data-testid={testIds.addToCart(product.id)}
                            onClick={() => cart.add(product.id)}
                            className="w-full rounded-lg bg-brand-ink text-white text-sm py-2 hover:opacity-90"
                        >
                            Add to cart
                        </button>
                    </div>
                </article>
            ))}
        </div>
    </section>
);

export const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: ProductsPage,
});
