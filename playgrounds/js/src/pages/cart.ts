import { displayTotalCents, formatMoney, shopApi } from '@flareapp/playgrounds-shared';

import { renderLayout } from '../layout';
import type { RouteHandler } from '../router';
import { cart } from '../state';

export const renderCart: RouteHandler = async (_match, root) => {
    const lines = cart.lines();

    if (lines.length === 0) {
        renderLayout(
            root,
            `<section>
                <h1 class="text-xl font-semibold mb-6">Cart</h1>
                <p class="text-sm opacity-70">Cart is empty.</p>
            </section>`,
        );
        return;
    }

    const summary = await shopApi.cartSummary(lines);

    const rows = summary.lines
        .map(
            (line) => `<tr data-testid="cart-item-${line.productId}" class="border-b border-surface-border">
                <td class="py-3">${line.title}</td>
                <td class="py-3 font-mono text-sm">${line.quantity}</td>
                <td class="py-3 font-mono text-sm">${formatMoney(line.price)}</td>
                <td class="py-3 text-right">
                    <button data-remove-id="${line.productId}" class="text-xs text-brand hover:underline">Remove</button>
                </td>
            </tr>`,
        )
        .join('');

    renderLayout(
        root,
        `<section>
            <h1 class="text-xl font-semibold mb-6">Cart</h1>
            <table class="w-full text-left">
                <thead class="text-xs uppercase opacity-60">
                    <tr><th class="py-2">Item</th><th class="py-2">Qty</th><th class="py-2">Price</th><th></th></tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
            <div class="mt-6 flex items-center justify-between">
                <div class="text-sm">Total: <span class="font-mono">${formatMoney({ amountCents: displayTotalCents(summary.lines), currency: 'USD' })}</span></div>
                <a data-link href="/checkout" class="rounded-lg bg-brand-ink text-white px-4 py-2 text-sm">Checkout</a>
            </div>
        </section>`,
    );

    root.querySelectorAll<HTMLButtonElement>('button[data-remove-id]').forEach((button) => {
        button.addEventListener('click', () => {
            cart.remove(button.dataset.removeId ?? '');
            void renderCart({ path: window.location.pathname, params: {} }, root);
        });
    });
};
