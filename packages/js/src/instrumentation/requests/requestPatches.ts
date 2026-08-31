import { instrumentFetch, unpatchFetch } from './instrumentFetch';
import { instrumentXHR, unpatchXHR } from './instrumentXHR';

let subscriptions = 0;

// Keeps fetch and XHR patched while at least one subscriber lives. Counted, so turning tracing off
// cannot remove a patch that breadcrumbs still need.
//
// `subscribe` registers one subscriber and returns its own teardown.
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

// Test helper. The SDK never calls this.
export function resetRequestPatches(): void {
    subscriptions = 0;
}
