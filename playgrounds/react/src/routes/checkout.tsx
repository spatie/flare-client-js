import { formatMoney, journeyGlows, placeOrder, recordGlow, shopApi, testIds } from '@flareapp/playgrounds-shared';
import { cart, useAsyncData } from '@flareapp/playgrounds-shared/react';
import { createRoute, useNavigate } from '@tanstack/react-router';
import type { FormEvent } from 'react';
import { useEffect } from 'react';

import { flare } from '../flare';
import { rootRoute } from './__root';

const CheckoutPage = () => {
    const navigate = useNavigate();
    const summary = useAsyncData(() => shopApi.cartSummary(cart.lines()), 'checkout');

    useEffect(() => {
        if (summary) recordGlow(flare, journeyGlows.openedCheckout(summary.lines.length));
    }, [summary]);

    const onSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!summary) return;

        // Throws synchronously when the cart holds the unpriced product, which is the showcase error.
        void placeOrder(summary).then(() => {
            cart.clear();
            void navigate({ to: '/confirmation' });
        });
    };

    return (
        <section className="max-w-md mx-auto">
            <h1 className="text-xl font-semibold mb-6">Checkout</h1>
            <ul className="mb-6 flex flex-col gap-1 text-sm">
                {summary?.lines.map((line) => (
                    <li key={line.productId} className="flex justify-between">
                        <span>
                            {line.title} x{line.quantity}
                        </span>
                        <span className="font-mono">{formatMoney(line.price)}</span>
                    </li>
                ))}
            </ul>
            <form onSubmit={onSubmit} className="flex flex-col gap-4">
                <label className="flex flex-col gap-1 text-sm">
                    Name
                    <input
                        name="name"
                        required
                        defaultValue="Iris De Witte"
                        className="rounded border border-surface-border px-3 py-2"
                    />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                    Email
                    <input
                        name="email"
                        type="email"
                        required
                        defaultValue="iris.dewitte@example.com"
                        className="rounded border border-surface-border px-3 py-2"
                    />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                    Card number
                    <input
                        name="card"
                        required
                        defaultValue="4242 4242 4242 4242"
                        className="rounded border border-surface-border px-3 py-2 font-mono"
                    />
                </label>
                {/* Disabled until the summary lands, so paying can never silently no-op. */}
                <button
                    type="submit"
                    disabled={!summary}
                    data-testid={testIds.checkoutSubmit}
                    className="rounded-lg bg-brand-ink text-white py-2 text-sm disabled:opacity-50"
                >
                    Pay
                </button>
            </form>
        </section>
    );
};

export const checkoutRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/checkout',
    component: CheckoutPage,
});
