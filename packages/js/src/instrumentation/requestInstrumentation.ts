import { instrumentFetch, unpatchFetch } from './instrumentFetch';

let consumers = 0;

/**
 * Subscribe to the request bus and keep the patches installed while anyone is listening.
 *
 * The patch belongs to nobody. Whoever arrives first causes the install, whoever leaves last causes the
 * removal, and behaviour comes from subscribing rather than from installing. Without this, tracing
 * toggling off at runtime would rip the patch out from under every other consumer.
 *
 * @param subscribe registers one consumer and returns its own teardown
 * @returns a teardown that unsubscribes and, when it was the last one, removes the patches
 */
export function useRequestBus(subscribe: () => () => void): () => void {
    if (consumers === 0) {
        instrumentFetch();
    }
    consumers++;

    const unsubscribe = subscribe();
    let released = false;

    return () => {
        if (released) {
            return;
        }
        released = true;
        unsubscribe();
        consumers--;
        if (consumers === 0) {
            unpatchFetch();
        }
    };
}

/** Test seam. Nothing in the SDK calls this. */
export function resetRequestInstrumentation(): void {
    consumers = 0;
}
