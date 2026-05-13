import { mount } from 'svelte';

import { createSidebar } from '../shared/createSidebar';
import { initFlare } from '../shared/initFlare';
import App from './App.svelte';

initFlare(import.meta.env.VITE_FLARE_SVELTE_KEY);

createSidebar();

mount(App, { target: document.querySelector('#root')! });
