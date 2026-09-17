import { playgroundRouterSetup } from '@flareapp/playgrounds-shared';
import { createBrowserRouter, createHashRouter } from 'react-router';

import { rootRoute } from './routes/root';

const { mode, base } = playgroundRouterSetup();

// A hash router has no page path option: its base is the page path in front of the `#`.
export const router =
    mode === 'hash' ? createHashRouter([rootRoute]) : createBrowserRouter([rootRoute], { basename: base });
