import { createFlareResolver } from '@flareapp/js/browser';

const { registerDefaultFlare, resolveFlare } = createFlareResolver({
    packageName: '@flareapp/svelte',
    injectInstruction:
        "Import @flareapp/svelte/inject (and set the preprocessor importSource to '@flareapp/svelte/inject') instead.",
});

export { registerDefaultFlare, resolveFlare };
