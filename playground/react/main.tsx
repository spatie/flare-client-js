import { createRoot } from 'react-dom/client';

import { createSidebar } from '../shared/create-sidebar';

import { App } from './App';

createSidebar();

createRoot(document.querySelector('#root')!).render(<App />);
