import type { FetchInput } from '../tracing/propagation';

export type RequestKind = 'fetch' | 'xhr';

export type RequestStart = {
    kind: RequestKind;
    method: string;
    /** As the caller gave it, so it can be relative. */
    url: string;
    /** Fetch only. `mergeTraceparentHeader` needs it to read headers off a `Request`. */
    input?: FetchInput;
    /** Fetch only. */
    init?: RequestInit;
};

export type RequestSettle = {
    /** Absent when the request got no response. */
    status?: number;
    error?: unknown;
};

export type RequestHandlers = {
    onSettle?(settle: RequestSettle): void;
};

export type RequestObserver = (start: RequestStart) => RequestHandlers | void;

export type RequestMutator = (start: RequestStart) => (RequestHandlers & { init?: RequestInit }) | void;

const observers = new Set<RequestObserver>();
let mutator: RequestMutator | null = null;

export function subscribeToRequests(observer: RequestObserver): () => void {
    observers.add(observer);
    return () => {
        observers.delete(observer);
    };
}

/**
 * The last claim wins: Vite HMR runs boot code again against the `fetch` that survived the reload,
 * and first-wins would leave the stale owner in charge.
 */
export function claimRequestMutation(owner: RequestMutator): () => void {
    if (mutator !== null) {
        console.warn(
            '%c FLARE %c Request mutation slot claimed twice.\n' +
                'The previous owner is now inactive, so outgoing requests can lose their ' +
                'traceparent header. Two features compete for the same request.',
            'background:#e11d48;color:#fff;font-weight:bold;font-size:14px;padding:2px 4px',
            'color:#e11d48;font-size:13px',
        );
    }
    mutator = owner;
    return () => {
        if (mutator === owner) {
            mutator = null;
        }
    };
}

export function hasRequestConsumers(): boolean {
    return observers.size > 0 || mutator !== null;
}

/** Test seam. The SDK never calls this. */
export function resetRequestBus(): void {
    observers.clear();
    mutator = null;
}

/**
 * Null means no consumer acted, and the caller must then send the original request untouched. Our
 * path turns a synchronous throw from the host fetch into a rejected promise.
 */
export function publishRequestStart(start: RequestStart): {
    settle(result: RequestSettle): void;
    init: RequestInit | undefined;
} | null {
    const handlers: RequestHandlers[] = [];

    for (const observer of observers) {
        try {
            const handler = observer(start);
            if (handler) {
                handlers.push(handler);
            }
        } catch {}
    }

    let init = start.init;
    if (mutator) {
        try {
            const handler = mutator(start);
            if (handler) {
                handlers.push(handler);
                if (handler.init !== undefined) {
                    init = handler.init;
                }
            }
        } catch {
            // A lost header only costs backend correlation.
        }
    }

    if (handlers.length === 0 && init === start.init) {
        return null;
    }

    return {
        init,
        settle(result: RequestSettle): void {
            for (const handler of handlers) {
                try {
                    handler.onSettle?.(result);
                } catch {}
            }
        },
    };
}
