import type { CartSummary } from '@flareapp/playgrounds-shared';
import { displayTotalCents, formatMoney, shopApi, testIds } from '@flareapp/playgrounds-shared';
import { cart, useAsyncData, useCart } from '@flareapp/playgrounds-shared/react';
import { withFlareProfiler } from '@flareapp/react/profiler';
import type { RouteObject } from 'react-router';
import { Link } from 'react-router';

const CartSummaryTable = withFlareProfiler(
    ({ summary }: { summary: CartSummary }) => (
        <>
            <table className="w-full text-left">
                <thead className="text-xs uppercase opacity-60">
                    <tr>
                        <th className="py-2">Item</th>
                        <th className="py-2">Qty</th>
                        <th className="py-2">Price</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    {summary.lines.map((line) => (
                        <tr
                            key={line.productId}
                            data-testid={testIds.cartItem(line.productId)}
                            className="border-b border-surface-border"
                        >
                            <td className="py-3">{line.title}</td>
                            <td className="py-3 font-mono text-sm">{line.quantity}</td>
                            <td className="py-3 font-mono text-sm">{formatMoney(line.price)}</td>
                            <td className="py-3 text-right">
                                <button
                                    type="button"
                                    onClick={() => cart.remove(line.productId)}
                                    className="text-xs text-brand hover:underline"
                                >
                                    Remove
                                </button>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <div className="mt-6 flex items-center justify-between">
                <div className="text-sm">
                    Total:{' '}
                    <span className="font-mono">
                        {formatMoney({ amountCents: displayTotalCents(summary.lines), currency: 'USD' })}
                    </span>
                </div>
                <Link to="/checkout" className="rounded-lg bg-brand-ink text-white px-4 py-2 text-sm">
                    Checkout
                </Link>
            </div>
        </>
    ),
    { name: 'CartSummary' },
);

const CartPage = () => {
    const lines = useCart();
    const key = lines.map((line) => `${line.productId}:${line.quantity}`).join(',');
    const summary = useAsyncData(() => shopApi.cartSummary(lines), `cart-${key}`);

    if (lines.length === 0) {
        return (
            <section>
                <h1 className="text-xl font-semibold mb-6">Cart</h1>
                <p className="text-sm opacity-70">Cart is empty.</p>
            </section>
        );
    }

    return (
        <section>
            <h1 className="text-xl font-semibold mb-6">Cart</h1>
            {summary ? (
                <CartSummaryTable summary={summary} />
            ) : (
                <p className="text-sm opacity-60">Pricing your cart…</p>
            )}
        </section>
    );
};

// Deliberately loader-less: the e2e suite uses this route as its loader-less navigation case.
export const cartRoute: RouteObject = {
    path: 'cart',
    Component: CartPage,
};
