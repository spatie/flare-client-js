'use client';

import { testIds } from '@flareapp/playgrounds-shared';
import Link from 'next/link';

import { useCartCount } from '@/cart';

export function Header() {
    const count = useCartCount();

    return (
        <header className="border-b border-surface-border bg-surface">
            <div className="mx-auto max-w-5xl px-6 py-4 flex items-center justify-between">
                <Link href="/" className="text-lg font-semibold tracking-tight">
                    Flare Pix
                </Link>
                <nav className="flex items-center gap-6">
                    <Link href="/" className="text-sm font-medium hover:text-brand">
                        Shop
                    </Link>
                    <Link href="/cart" className="text-sm font-medium hover:text-brand">
                        Cart
                    </Link>
                    <Link href="/broken" className="text-sm font-medium hover:text-brand">
                        Broken
                    </Link>
                    <Link
                        href="/cart"
                        data-testid={testIds.cartCount}
                        className="rounded-full bg-brand px-3 py-1 text-xs font-semibold text-white"
                    >
                        {count}
                    </Link>
                </nav>
            </div>
        </header>
    );
}
