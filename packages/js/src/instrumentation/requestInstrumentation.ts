import { instrumentFetch, unpatchFetch } from './instrumentFetch';
import { instrumentXHR, unpatchXHR } from './instrumentXHR';

let subscriptions = 0;

/**
 * We count the live subscriptions. Without that count, tracing turned off at runtime would remove a
 * patch that another subscriber still needs.
 *
 * @param subscribe registers one subscriber and returns its own teardown
 */
export function withRequestPatches(subscribe: () => () => void): () => void {
    if (subscriptions === 0) {
        instrumentFetch();
        instrumentXHR();
    }
    subscriptions++;

    const unsubscribe = subscribe();
    let removed = false;

    return () => {
        if (removed) {
            return;
        }
        removed = true;
        unsubscribe();
        subscriptions--;
        if (subscriptions === 0) {
            unpatchFetch();
            unpatchXHR();
        }
    };
}

// This is a helper function for use in the test suite only.
// The SDK never calls this.
export function resetRequestPatches(): void {
    subscriptions = 0;
}
