import { flareReactErrorHandler } from '@flareapp/react';
import { createRoot } from 'react-dom/client';

import { createSidebar } from '../shared/createSidebar';
import { initFlare } from '../shared/initFlare';

import { App } from './App';

initFlare(import.meta.env.VITE_FLARE_REACT_KEY);

createSidebar();

createRoot(document.querySelector('#root')!, {
    // Not using onCaughtError here because FlareErrorBoundary already reports caught errors. Using both would result in duplicate reports.
    // onCaughtError: flareReactErrorHandler({
    //     afterSubmit: ({ error, errorInfo }) => {
    //         console.log('onCaughtError', error, errorInfo.componentStack);
    //     },
    // }),
    onUncaughtError: flareReactErrorHandler({
        afterSubmit: ({ error, errorInfo }) => {
            console.log('onUncaughtError', error, errorInfo.componentStack);
        },
    }),
    onRecoverableError: flareReactErrorHandler({
        afterSubmit: ({ error, errorInfo }) => {
            console.log('onRecoverableError', error, errorInfo.componentStack);
        },
    }),
}).render(<App />);
