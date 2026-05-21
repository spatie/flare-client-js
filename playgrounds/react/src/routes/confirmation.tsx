import { testIds } from '@flareapp/playgrounds-shared';
import { createRoute, Link } from '@tanstack/react-router';

import { rootRoute } from './__root';

const ConfirmationPage = () => (
    <section data-testid={testIds.confirmation} className="text-center py-16">
        <h1 className="text-2xl font-semibold mb-2">Order confirmed</h1>
        <p className="text-sm opacity-70 mb-6">A receipt was sent to your inbox.</p>
        <Link to="/" className="text-sm text-brand hover:underline">
            Continue shopping
        </Link>
    </section>
);

export const confirmationRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/confirmation',
    component: ConfirmationPage,
});
