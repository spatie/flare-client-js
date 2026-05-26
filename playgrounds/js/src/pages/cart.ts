import { productById } from '@flareapp/playgrounds-shared';

import { renderLayout } from '../layout';
import type { RouteHandler } from '../router';
import { cart } from '../state';

export const renderCart: RouteHandler = (_match, root) => {
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

    const rows = lines
        .map((line) => {
            const product = productById(line.productId);
            if (!product) return '';
            const subtotal = (product.priceCents * line.quantity) / 100;
            return `<tr data-testid="cart-item-${product.id}" class="border-b border-surface-border">
                <td class="py-3">${product.title}</td>
                <td class="py-3 font-mono text-sm">${line.quantity}</td>
                <td class="py-3 font-mono text-sm">$${subtotal.toFixed(2)}</td>
                <td class="py-3 text-right">
                    <button data-remove-id="${product.id}" class="text-xs text-brand hover:underline">Remove</button>
                </td>
            </tr>`;
        })
        .join('');

    const total = lines.reduce((sum, line) => {
        const product = productById(line.productId);
        return product ? sum + product.priceCents * line.quantity : sum;
    }, 0);

    renderLayout(
        root,
        `<section>
            <h1 class="text-xl font-semibold mb-6">Cart</h1>
            <table class="w-full text-left">
                <thead class="text-xs uppercase opacity-60">
                    <tr><th class="py-2">Item</th><th class="py-2">Qty</th><th class="py-2">Subtotal</th><th></th></tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
            <div class="mt-6 flex items-center justify-between">
                <div class="text-sm">Total: <span class="font-mono">$${(total / 100).toFixed(2)}</span></div>
                <a data-link href="/checkout" class="rounded-lg bg-brand-ink text-white px-4 py-2 text-sm">Checkout</a>
            </div>
        </section>`,
    );

    root.querySelectorAll<HTMLButtonElement>('button[data-remove-id]').forEach((button) => {
        button.addEventListener('click', () => {
            cart.remove(button.dataset.removeId ?? '');
            renderCart({ path: window.location.pathname, params: {} }, root);
        });
    });
};
