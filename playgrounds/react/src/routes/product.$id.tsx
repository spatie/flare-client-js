import { formatMoney, journeyGlows, recordGlow, shopApi, testIds, unsplashUrl } from '@flareapp/playgrounds-shared';
import { cart, useAsyncData } from '@flareapp/playgrounds-shared/react';
import { withFlareProfiler } from '@flareapp/react/profiler';
import { createRoute } from '@tanstack/react-router';
import { useEffect } from 'react';

import { ColorPalette } from '../components/ColorPalette';
import { flare } from '../flare';
import { rootRoute } from './__root';

const ProductPage = () => {
    const { id } = productRoute.useParams();
    const data = useAsyncData(
        () =>
            Promise.all([shopApi.product(id).catch(() => null), shopApi.recommendations(id)]).then(
                ([detail, recommended]) => ({ detail, recommended }),
            ),
        `product-${id}`,
    );

    const product = data?.detail?.product;

    useEffect(() => {
        if (product) recordGlow(flare, journeyGlows.viewedProduct(product));
    }, [product]);

    if (!data) {
        return <p className="text-sm opacity-60">Loading print…</p>;
    }

    if (!product) {
        return <p>Product not found.</p>;
    }

    const triggerBroken = () => {
        void flare.report(new Error(`broken-solution:${product.id}`), {
            'context.product': { id: product.id, title: product.title },
        });
    };

    return (
        <article className="grid md:grid-cols-2 gap-8">
            <img
                src={unsplashUrl(product.unsplashId, 800, 800)}
                alt={product.title}
                className="aspect-square w-full object-cover rounded-2xl"
            />
            <div className="flex flex-col gap-4">
                <h1 className="text-2xl font-semibold">{product.title}</h1>
                <p className="text-sm opacity-70">Photograph by {product.photographer}</p>
                <p className="text-sm opacity-70">{data.detail?.description}</p>
                <div className="text-xl font-mono">{formatMoney(product.price)}</div>
                {/* Before AddToCartButton on purpose: a profiled span ends at commit, so a sibling
                    rendered ahead of this one absorbs its 1.5s and looks slow too. */}
                <ColorPalette unsplashId={product.unsplashId} />
                <AddToCartButton
                    testId={testIds.addToCart(product.id)}
                    onClick={() => {
                        cart.add(product.id);
                        recordGlow(flare, journeyGlows.addedToCart(product.id, cart.count()));
                    }}
                />
                <button
                    type="button"
                    onClick={triggerBroken}
                    className="rounded-lg border border-brand text-brand py-3 hover:bg-brand-soft"
                >
                    Trigger broken solution
                </button>
                <p className="text-xs opacity-60">
                    Also like: {data.recommended.map((other) => other.title).join(' · ')}
                </p>
            </div>
        </article>
    );
};

export const productRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/product/$id',
    component: withFlareProfiler(ProductPage, { name: 'ProductPage' }),
});

const AddToCartButton = withFlareProfiler(
    ({ testId, onClick }: { testId: string; onClick: () => void }) => (
        <button
            type="button"
            data-testid={testId}
            onClick={onClick}
            className="rounded-lg bg-brand-ink text-white py-3 hover:opacity-90"
        >
            Add to cart
        </button>
    ),
    { name: 'AddToCartButton' },
);
