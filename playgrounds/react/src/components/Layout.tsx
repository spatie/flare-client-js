import { testIds } from '@flareapp/playgrounds-shared';
import { Link, Outlet } from '@tanstack/react-router';

import { useCartCount } from '../cart';

export const Layout = () => {
    const count = useCartCount();

    return (
        <div className="min-h-screen flex flex-col">
            <header className="border-b border-surface-border bg-surface">
                <div className="mx-auto max-w-5xl px-6 py-4 flex items-center justify-between">
                    <Link to="/" className="text-lg font-semibold tracking-tight">
                        Flare Pix
                    </Link>
                    <nav className="flex items-center gap-6">
                        <Link to="/" className="text-sm font-medium hover:text-brand">
                            Shop
                        </Link>
                        <Link to="/cart" className="text-sm font-medium hover:text-brand">
                            Cart
                        </Link>
                        <Link to="/broken" className="text-sm font-medium hover:text-brand">
                            Broken
                        </Link>
                        <Link
                            to="/cart"
                            data-testid={testIds.cartCount}
                            className="rounded-full bg-brand px-3 py-1 text-xs font-semibold text-white"
                        >
                            {count}
                        </Link>
                    </nav>
                </div>
            </header>
            <main className="flex-1 mx-auto max-w-5xl w-full px-6 py-8">
                <Outlet />
            </main>
        </div>
    );
};
