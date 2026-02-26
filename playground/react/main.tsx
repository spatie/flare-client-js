import { createRoot } from 'react-dom/client';

import { createSidebar } from '../shared/create-sidebar';

import { App } from './App';

createSidebar();

createRoot(document.querySelector('#root')!, {
    // Not using callbacks here because FlareErrorBoundary already reports caught errors. Using both would result in duplicate reports.
    // onCaughtError: flareReactErrorHandler((error, errorInfo) => {
    //     console.log('onCaughtError', error, errorInfo.componentStack);
    // }),
    // onUncaughtError: flareReactErrorHandler((error, errorInfo) => {
    //     console.log('onUncaughtError', error, errorInfo.componentStack);
    // }),
    // onRecoverableError: flareReactErrorHandler((error, errorInfo) => {
    //     console.log('onRecoverableError', error, errorInfo.componentStack);
    // }),
}).render(<App />);
