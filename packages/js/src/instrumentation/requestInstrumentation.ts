import { instrumentFetch, unpatchFetch } from './instrumentFetch';

let consumers = 0;

/**
 * Counted, so tracing turned off at runtime cannot remove a patch other consumers still need.
 *
 * @param subscribe registers the consumer and returns its own teardown
 */
export function addRequestConsumer(subscribe: () => () => void): () => void {
    if (consumers === 0) {
        instrumentFetch();
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
        }
    };
}

/** Test seam. The SDK never calls this. */
export function resetRequestInstrumentation(): void {
    consumers = 0;
}
