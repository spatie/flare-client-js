import type { FetchInput } from '../tracing/propagation';

export type RequestKind = 'fetch' | 'xhr';

export type RequestStart = {
    kind: RequestKind;
    method: string;
    /** Exactly what the caller passed, so it can be a relative path. */
    url: string;
    /** Fetch only. `mergeTraceparentHeader` reads headers from a `Request` object. */
    input?: FetchInput;
    /** Fetch only. */
    init?: RequestInit;
};

export type RequestSettle = {
    /** Not set when the request got no response. */
    status?: number;
    error?: unknown;
    /** XHR only. A second `open()` stops a request that still runs, and no DONE event follows. */
    aborted?: boolean;
};

export type RequestHandlers = {
    onSettle?(settle: RequestSettle): void;
};

export type RequestObserver = (start: RequestStart) => RequestHandlers | void;

/** fetch uses `init`, XHR uses `headers`. Each one ignores the field it cannot apply. */
export type MutatedRequest = { init?: RequestInit; headers?: Record<string, string> };

export type RequestMutator = (start: RequestStart) => (RequestHandlers & MutatedRequest) | void;

const observers = new Set<RequestObserver>();
let mutator: RequestMutator | null = null;

export function subscribeToRequests(observer: RequestObserver): () => void {
    observers.add(observer);
    return () => {
        observers.delete(observer);
    };
}

/**
 * The newest claim wins. Vite HMR runs the start-up code again, and the owner from before is gone.
 * If the first claim won, that dead owner would keep the slot.
 */
export function claimRequestMutation(owner: RequestMutator): () => void {
    if (mutator !== null) {
        console.warn(
            `%c FLARE %c

What: two things tried to add headers to outgoing requests. Only one can.

Why it matters: the first one stopped. Requests can now go out without a traceparent header, so Flare cannot link a browser request to its server trace.

How to fix: use one Flare instance, and check your bundle for two copies of @flareapp/js.`,
            'background:#e11d48;color:#fff;font-weight:bold;font-size:14px;padding:2px 6px',
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

// This is a helper function for use in the test suite only.
// The SDK never calls this.
export function resetRequestBus(): void {
    observers.clear();
    mutator = null;
}

/**
 * Returns null when nothing listens to this request.
 *
 * The caller must then run the real `fetch` or `send` directly, and skip its own code. That code
 * catches an error the browser throws right away, and returns a rejected promise instead. So
 * `try { fetch() } catch` stops working for the app. When nobody needs the data, the app must get
 * the same result it would get without Flare.
 */
export function publishRequestStart(start: RequestStart): {
    settle(result: RequestSettle): void;
    init: RequestInit | undefined;
    headers: Record<string, string> | undefined;
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
    let headers: Record<string, string> | undefined;
    if (mutator) {
        try {
            const handler = mutator(start);
            if (handler) {
                handlers.push(handler);
                if (handler.init !== undefined) {
                    init = handler.init;
                }
                headers = handler.headers;
            }
        } catch {
            // Without the header the backend cannot link this request to its trace. The request is fine.
        }
    }

    if (handlers.length === 0 && init === start.init && headers === undefined) {
        return null;
    }

    return {
        init,
        headers,
        settle(result: RequestSettle): void {
            for (const handler of handlers) {
                try {
                    handler.onSettle?.(result);
                } catch {}
            }
        },
    };
}
