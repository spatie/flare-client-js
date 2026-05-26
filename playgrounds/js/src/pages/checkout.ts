import { renderLayout } from '../layout';
import type { RouteHandler } from '../router';
import { cart } from '../state';

export const renderCheckout: RouteHandler = (_match, root) => {
    renderLayout(
        root,
        `<section class="max-w-md mx-auto">
            <h1 class="text-xl font-semibold mb-6">Checkout</h1>
            <form id="checkout-form" class="flex flex-col gap-4">
                <label class="flex flex-col gap-1 text-sm">
                    Name
                    <input name="name" required value="Test User" class="rounded border border-surface-border px-3 py-2" />
                </label>
                <label class="flex flex-col gap-1 text-sm">
                    Email
                    <input name="email" type="email" required value="test@example.com" class="rounded border border-surface-border px-3 py-2" />
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
        cart.clear();
        window.history.pushState({}, '', '/confirmation');
        window.dispatchEvent(new PopStateEvent('popstate'));
    });
};
