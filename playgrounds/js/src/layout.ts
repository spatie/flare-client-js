import { cart } from './state';

const navLink = (href: string, label: string): string =>
    `<a data-link href="${href}" class="text-sm font-medium hover:text-brand">${label}</a>`;

export const renderLayout = (root: HTMLElement, content: string): void => {
    root.innerHTML = `
        <div class="min-h-screen flex flex-col">
            <header class="border-b border-surface-border bg-surface">
                <div class="mx-auto max-w-5xl px-6 py-4 flex items-center justify-between">
                    <a data-link href="/" class="text-lg font-semibold tracking-tight">Flare Pix</a>
                    <nav class="flex items-center gap-6">
                        ${navLink('/', 'Shop')}
                        ${navLink('/cart', 'Cart')}
                        ${navLink('/broken', 'Broken')}
                        <a data-link href="/cart" class="rounded-full bg-brand px-3 py-1 text-xs font-semibold text-white" data-testid="cart-count">${cart.count()}</a>
                    </nav>
                </div>
            </header>
            <main class="flex-1 mx-auto max-w-5xl w-full px-6 py-8">${content}</main>
        </div>
    `;
};

export const updateCartBadge = (): void => {
    const badge = document.querySelector('[data-testid="cart-count"]');
    if (badge) badge.textContent = String(cart.count());
};
