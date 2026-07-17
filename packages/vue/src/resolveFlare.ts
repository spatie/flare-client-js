import { createFlareResolver } from '@flareapp/js/browser';

const { registerDefaultFlare, resolveFlare } = createFlareResolver({ packageName: '@flareapp/vue' });

export { registerDefaultFlare, resolveFlare };
