'use client';

import { productById, testIds } from '@flareapp/playgrounds-shared';
import Link from 'next/link';

import { cart, useCart } from '@/cart';

export default function CartPage() {
    const lines = useCart();

    if (lines.length === 0) {
        return (
            <section>
                <h1 className="text-xl font-semibold mb-6">Cart</h1>
                <p className="text-sm opacity-70">Cart is empty.</p>
            </section>
        );
    }

    const total = lines.reduce((sum, line) => {
        const product = productById(line.productId);
        return product ? sum + product.priceCents * line.quantity : sum;
    }, 0);

    return (
        <section>
            <h1 className="text-xl font-semibold mb-6">Cart</h1>
            <table className="w-full text-left">
                <thead className="text-xs uppercase opacity-60">
                    <tr>
                        <th className="py-2">Item</th>
                        <th className="py-2">Qty</th>
                        <th className="py-2">Subtotal</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    {lines.map((line) => {
                        const product = productById(line.productId);
                        if (!product) return null;
                        const subtotal = (product.priceCents * line.quantity) / 100;
                        return (
                            <tr
                                key={product.id}
                                data-testid={testIds.cartItem(product.id)}
                                className="border-b border-surface-border"
                            >
                                <td className="py-3">{product.title}</td>
                                <td className="py-3 font-mono text-sm">{line.quantity}</td>
                                <td className="py-3 font-mono text-sm">${subtotal.toFixed(2)}</td>
                                <td className="py-3 text-right">
                                    <button
                                        type="button"
                                        onClick={() => cart.remove(product.id)}
                                        className="text-xs text-brand hover:underline"
                                    >
                                        Remove
                                    </button>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
            <div className="mt-6 flex items-center justify-between">
                <div className="text-sm">
                    Total: <span className="font-mono">${(total / 100).toFixed(2)}</span>
                </div>
                <Link href="/checkout" className="rounded-lg bg-brand-ink text-white px-4 py-2 text-sm">
                    Checkout
                </Link>
            </div>
        </section>
    );
}
