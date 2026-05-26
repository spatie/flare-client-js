'use client';

import { productById, testIds, unsplashUrl } from '@flareapp/playgrounds-shared';
import { useParams } from 'next/navigation';

import { cart } from '@/cart';
import { flare } from '@/flare';

export default function ProductPage() {
    const params = useParams<{ id: string }>();
    const product = productById(params.id);

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
                <button
                    type="button"
                    data-testid={testIds.addToCart(product.id)}
                    onClick={() => cart.add(product.id)}
                    className="rounded-lg bg-brand-ink text-white py-3 hover:opacity-90"
                >
                    Add to cart
                </button>
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
}
