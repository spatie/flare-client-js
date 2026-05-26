import '@flareapp/playgrounds-shared/styles.css';
import { FlareErrorBoundary } from '@flareapp/react';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';

import { Fallback } from './components/Fallback';
import { initFlare } from './flare';
import { router } from './router';

initFlare();

// Track the router pathname via router.subscribe so the boundary can read it
// without being mounted inside RouterProvider. The boundary needs to wrap
// RouterProvider, so we can't use useRouterState here.
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
