import { routeRejection, type RejectionReporter } from '@flareapp/core';

/**
 * Wire up global `error` and `unhandledrejection` listeners, routing reports through `window.flare`
 * (assigned by Flare.light()/configure()). Events are dropped, not queued, when the global is absent.
 */
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

        // Shared routing: Error/stack-bearing -> reportSilently, stackless ->
        // reportUnhandledRejection. Same path the RN engine tracker uses.
        routeRejection(flare, event.reason);
    });
}
