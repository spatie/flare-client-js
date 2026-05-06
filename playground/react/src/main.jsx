import { flare } from '@flareapp/js';
import { FlareErrorBoundary } from '@flareapp/react';
import React from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';

flare.light(import.meta.env.VITE_FLARE_KEY, true);

createRoot(document.getElementById('root')).render(
    <FlareErrorBoundary>
        <App />
    </FlareErrorBoundary>
);
