import { catchWindowErrors } from '@flareapp/js/browser';

import { RendererFlare } from './renderer/RendererFlare';

export const flare = new RendererFlare();

if (typeof window !== 'undefined' && window) {
    // catchWindowErrors reports through window.flare, so the instance must be assigned first.
    // @ts-expect-error attach to window
    window.flare = flare;
    catchWindowErrors();
}

export { RendererFlare } from './renderer/RendererFlare';
export type { RendererFlareOptions } from './renderer/RendererFlare';
export { FLARE_BRIDGE_KEY } from './constants';
