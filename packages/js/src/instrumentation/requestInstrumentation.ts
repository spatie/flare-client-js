import { instrumentFetch, unpatchFetch } from './instrumentFetch';
import { instrumentXHR, unpatchXHR } from './instrumentXHR';

let consumers = 0;

/**
 * We count the consumers. Without that count, tracing turned off at runtime would remove a patch
 * that another consumer still needs.
 *
 * @param subscribe registers the consumer and returns its own teardown
 */
export function addRequestConsumer(subscribe: () => () => void): () => void {
    if (consumers === 0) {
        instrumentFetch();
        instrumentXHR();
    }
    consumers++;

    const unsubscribe = subscribe();
    let removed = false;

    return () => {
        if (removed) {
            return;
        }
        removed = true;
        unsubscribe();
        consumers--;
        if (consumers === 0) {
            unpatchFetch();
            unpatchXHR();
        }
    };
}

// This is a helper function for use in the test suite only.
// The SDK never calls this.
export function resetRequestInstrumentation(): void {
    consumers = 0;
}
