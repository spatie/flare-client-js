import '@flareapp/playgrounds-shared/styles.css';
import { traceReactRouter } from '@flareapp/react/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';

import { initFlare } from './flare';
import { router } from './router';

initFlare();
traceReactRouter(router as unknown as Parameters<typeof traceReactRouter>[0]);

const container = document.getElementById('root');
if (!container) throw new Error('No #root element');

createRoot(container).render(
    <StrictMode>
        <RouterProvider router={router} />
    </StrictMode>,
);
