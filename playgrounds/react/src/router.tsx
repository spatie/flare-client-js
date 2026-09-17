import { playgroundRouterSetup } from '@flareapp/playgrounds-shared';
import { createBrowserHistory, createHashHistory, createRouter } from '@tanstack/react-router';

import { rootRoute } from './routes/__root';
import { brokenRoute } from './routes/broken';
import { cartRoute } from './routes/cart';
import { checkoutRoute } from './routes/checkout';
import { confirmationRoute } from './routes/confirmation';
import { httpRoute } from './routes/http';
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
    httpRoute,
    reactInvariantRoute,
]);

// Disables TanStack Router's per-route error component so render errors bubble up to the
// outer FlareErrorBoundary instead: disableGlobalCatchBoundary turns off the router-level
// catch, and re-throwing in defaultErrorComponent lets React's own boundary carry it up.
const { mode, base } = playgroundRouterSetup();

export const router = createRouter({
    routeTree,
    // A hash history has no basepath: its base is the page path in front of the `#`.
    history: mode === 'hash' ? createHashHistory() : createBrowserHistory(),
    basepath: mode === 'hash' ? '/' : base,
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
