import { navigating } from '$app/state';

declare global {
    interface Window {
        __navStates?: string[];
    }
}

// Records every `navigating` transition an effect root observes at client-init. Playground-only:
// proves the non-null state isn't batched away, the one assumption traceSvelteKitRouter relies on.
// Mirrors the SDK's effect shape (`$effect.root` in a `.svelte.ts` module from hooks.client.ts).
export function startNavProbe(): void {
    window.__navStates = [];
    $effect.root(() => {
        $effect(() => {
            window.__navStates?.push(navigating.to ? `to:${navigating.to.url.pathname}` : 'null');
        });
    });
}
