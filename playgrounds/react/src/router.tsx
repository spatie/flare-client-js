import { createRouter } from '@tanstack/react-router';

import { rootRoute } from './routes/__root';
import { brokenRoute } from './routes/broken';
import { cartRoute } from './routes/cart';
import { checkoutRoute } from './routes/checkout';
import { confirmationRoute } from './routes/confirmation';
import { indexRoute } from './routes/index';
import { productRoute } from './routes/product.$id';
import { reactInvariantRoute } from './routes/reactInvariant';

const routeTree = rootRoute.addChildren([
    indexRoute,
    productRoute,
    cartRoute,
    checkoutRoute,
    confirmationRoute,
    brokenRoute,
    reactInvariantRoute,
]);

// Disable TanStack Router's default per-route error component so render errors
// bubble up to the outer FlareErrorBoundary. disableGlobalCatchBoundary turns
// off the outer router-level catch; defaultErrorComponent re-throws inside the
// per-route catch so React error boundary semantics carry the error up to
// FlareErrorBoundary mounted outside RouterProvider.
export const router = createRouter({
    routeTree,
    disableGlobalCatchBoundary: true,
    defaultErrorComponent: ({ error }) => {
        throw error;
    },
});

declare module '@tanstack/react-router' {
    interface Register {
        router: typeof router;
    }
}
