import { createFlareResolver } from '@flareapp/js/browser';

const { registerDefaultFlare, resolveFlare } = createFlareResolver({ packageName: '@flareapp/react' });

export { registerDefaultFlare, resolveFlare };
