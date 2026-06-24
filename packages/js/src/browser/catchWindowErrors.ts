// Wires up global `error` and `unhandledrejection` listeners. Reports are routed through
// `window.flare`, which the host app must assign (see Flare.light()/configure()). If the global
// is not present (e.g. flare not initialised yet), events are silently dropped rather than queued.

import { routeRejection, type RejectionReporter } from '@flareapp/core';

export function catchWindowErrors() {
    if (typeof window === 'undefined') {
        return;
    }

    window.addEventListener('error', (event: ErrorEvent) => {
        const flare = (window as unknown as { flare?: RejectionReporter }).flare;
        if (!flare) return;
        // ErrorEvent.error is null for cross-origin script errors ("Script error."), skip those.
        if (event.error instanceof Error) {
            flare.reportSilently(event.error);
        }
    });

    window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
        const flare = (window as unknown as { flare?: RejectionReporter }).flare;
        if (!flare) return;

        // Shared routing (Error/stack-bearing -> reportSilently, stackless ->
        // reportUnhandledRejection); same path the RN engine tracker uses.
        routeRejection(flare, event.reason);
    });
}
