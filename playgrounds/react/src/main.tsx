import '@flareapp/playgrounds-shared/styles.css';
import { Fallback } from '@flareapp/playgrounds-shared/react';
import { FlareErrorBoundary } from '@flareapp/react';
import { traceTanStackRouter } from '@flareapp/react/tanstack-router';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';

import { initFlare } from './flare';
import { router } from './router';

initFlare();
traceTanStackRouter(router);

// Tracks the pathname via router.subscribe instead of useRouterState, since the boundary
// wraps RouterProvider rather than mounting inside it.
const subscribePathname = (listener: () => void): (() => void) => router.subscribe('onResolved', listener);

const getPathname = (): string => router.state.location.pathname;

const BoundaryShell = () => {
    const pathname = useSyncExternalStore(subscribePathname, getPathname, getPathname);
    return (
        <FlareErrorBoundary fallback={Fallback} resetKeys={[pathname]}>
            <RouterProvider router={router} />
        </FlareErrorBoundary>
    );
};

const container = document.getElementById('root');
if (!container) throw new Error('No #root element');

createRoot(container).render(
    <StrictMode>
        <BoundaryShell />
    </StrictMode>,
);
