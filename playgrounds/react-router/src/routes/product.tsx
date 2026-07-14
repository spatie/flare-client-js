import { productById, testIds, unsplashUrl, type Product } from '@flareapp/playgrounds-shared';
import { withFlareProfiler } from '@flareapp/react/profiler';
import type { LoaderFunctionArgs, RouteObject } from 'react-router';
import { useLoaderData } from 'react-router';

import { cart } from '../cart';
import { flare } from '../flare';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

type ProductLoaderData = { product: Product | undefined };

export async function productLoader({ params }: LoaderFunctionArgs): Promise<ProductLoaderData> {
    // Artificial loading window so the client navigation opens a held browser_navigation root
    // (traceReactRouter's loader branch). No network dependency keeps the e2e deterministic.
    await sleep(150);
    return { product: productById(params.id ?? '') };
}

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

const ProductPage = () => {
    const { product } = useLoaderData() as ProductLoaderData;

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
                <div className="text-xl font-mono">${(product.priceCents / 100).toFixed(2)}</div>
                <AddToCartButton testId={testIds.addToCart(product.id)} onClick={() => cart.add(product.id)} />
                <button
                    type="button"
                    onClick={triggerBroken}
                    className="rounded-lg border border-brand text-brand py-3 hover:bg-brand-soft"
                >
                    Trigger broken solution
                </button>
            </div>
        </article>
    );
};

export const productRoute: RouteObject = {
    path: 'product/:id',
    loader: productLoader,
    Component: withFlareProfiler(ProductPage, { name: 'ProductPage' }),
};
