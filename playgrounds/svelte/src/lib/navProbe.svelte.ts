import { navigating } from '$app/state';

declare global {
    interface Window {
        __navStates?: string[];
    }
}

/**
 * Record every `navigating` transition an effect root created at client-init actually observes.
 * Playground-only: it exists so the e2e suite can prove the non-null state is not batched away,
 * which is the one assumption traceSvelteKitRouter rests on. Mirrors the SDK's effect shape (an
 * `$effect.root` from a `.svelte.ts` module invoked by hooks.client.ts) as closely as possible.
 */
export function startNavProbe(): void {
    window.__navStates = [];
    $effect.root(() => {
        $effect(() => {
            window.__navStates?.push(navigating.to ? `to:${navigating.to.url.pathname}` : 'null');
        });
    });
}
