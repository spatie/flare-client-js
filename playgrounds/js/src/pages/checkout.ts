import { formatMoney, journeyGlows, placeOrder, recordGlow, shopApi } from '@flareapp/playgrounds-shared';

import { flare } from '../flare';
import { renderLayout } from '../layout';
import type { RouteHandler } from '../router';
import { cart } from '../state';

export const renderCheckout: RouteHandler = async (_match, root) => {
    const summary = await shopApi.cartSummary(cart.lines());
    recordGlow(flare, journeyGlows.openedCheckout(summary.lines.length));

    const lines = summary.lines
        .map(
            (line) =>
                `<li class="flex justify-between"><span>${line.title} x${line.quantity}</span><span class="font-mono">${formatMoney(line.price)}</span></li>`,
        )
        .join('');

    renderLayout(
        root,
        `<section class="max-w-md mx-auto">
            <h1 class="text-xl font-semibold mb-6">Checkout</h1>
            <ul class="mb-6 flex flex-col gap-1 text-sm">${lines}</ul>
            <form id="checkout-form" class="flex flex-col gap-4">
                <label class="flex flex-col gap-1 text-sm">
                    Name
                    <input name="name" required value="Iris De Witte" class="rounded border border-surface-border px-3 py-2" />
                </label>
                <label class="flex flex-col gap-1 text-sm">
                    Email
                    <input name="email" type="email" required value="iris.dewitte@example.com" class="rounded border border-surface-border px-3 py-2" />
                </label>
                <label class="flex flex-col gap-1 text-sm">
                    Card number
                    <input name="card" required value="4242 4242 4242 4242" class="rounded border border-surface-border px-3 py-2 font-mono" />
                </label>
                <button type="submit" data-testid="checkout-submit" class="rounded-lg bg-brand-ink text-white py-2 text-sm">Pay</button>
            </form>
        </section>`,
    );

    root.querySelector<HTMLFormElement>('#checkout-form')?.addEventListener('submit', (event) => {
        event.preventDefault();

        // Throws synchronously when the cart holds the unpriced product, which is the showcase error.
        void placeOrder(summary).then(() => {
            cart.clear();
            window.history.pushState({}, '', '/confirmation');
            window.dispatchEvent(new PopStateEvent('popstate'));
        });
    });
};
