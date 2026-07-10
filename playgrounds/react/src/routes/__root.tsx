import { withFlareProfiler } from '@flareapp/react/profiler';
import { createRootRoute, RouteComponent } from '@tanstack/react-router';

import { Layout } from '../components/Layout';

export const rootRoute = createRootRoute({
    component: withFlareProfiler(Layout, { name: 'Layout' }) as RouteComponent,
});
