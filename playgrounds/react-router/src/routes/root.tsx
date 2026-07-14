import { testIds } from '@flareapp/playgrounds-shared';
import { FlareErrorBoundary } from '@flareapp/react';
import { withFlareProfiler } from '@flareapp/react/profiler';
import type { RouteObject } from 'react-router';
import { Link, Outlet, useLocation } from 'react-router';

import { useCartCount } from '../cart';
import { Fallback } from '../components/Fallback';
import { brokenRoute } from './broken';
import { cartRoute } from './cart';
import { checkoutRoute } from './checkout';
import { confirmationRoute } from './confirmation';
import { productRoute } from './product';
import { productsRoute } from './products';

const RootLayout = () => {
    const count = useCartCount();
    const pathname = useLocation().pathname;

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
                <FlareErrorBoundary fallback={Fallback} resetKeys={[pathname]}>
                    <Outlet />
                </FlareErrorBoundary>
            </main>
        </div>
    );
};

export const rootRoute: RouteObject = {
    path: '/',
    Component: withFlareProfiler(RootLayout, { name: 'Layout' }),
    children: [productsRoute, productRoute, cartRoute, checkoutRoute, confirmationRoute, brokenRoute],
};
