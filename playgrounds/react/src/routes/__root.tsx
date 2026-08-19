import { withFlareProfiler } from '@flareapp/react/profiler';
import { createRootRoute } from '@tanstack/react-router';

import { Layout } from '../components/Layout';

export const rootRoute = createRootRoute({
    component: withFlareProfiler(Layout, { name: 'Layout' }),
});
