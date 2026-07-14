import { testIds } from '@flareapp/playgrounds-shared';
import type { FormEvent } from 'react';
import type { RouteObject } from 'react-router';
import { useNavigate } from 'react-router';

import { cart } from '../cart';

const CheckoutPage = () => {
    const navigate = useNavigate();

    const onSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        cart.clear();
        void navigate('/confirmation');
    };

    return (
        <section className="max-w-md mx-auto">
            <h1 className="text-xl font-semibold mb-6">Checkout</h1>
            <form onSubmit={onSubmit} className="flex flex-col gap-4">
                <label className="flex flex-col gap-1 text-sm">
                    Name
                    <input
                        name="name"
                        required
                        defaultValue="Test User"
                        className="rounded border border-surface-border px-3 py-2"
                    />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                    Email
                    <input
                        name="email"
                        type="email"
                        required
                        defaultValue="test@example.com"
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
                <button
                    type="submit"
                    data-testid={testIds.checkoutSubmit}
                    className="rounded-lg bg-brand-ink text-white py-2 text-sm"
                >
                    Pay
                </button>
            </form>
        </section>
    );
};

export const checkoutRoute: RouteObject = {
    path: 'checkout',
    Component: CheckoutPage,
};
