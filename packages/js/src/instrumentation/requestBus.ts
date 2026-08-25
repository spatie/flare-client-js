import type { FetchInput } from '../tracing/propagation';

export type RequestKind = 'fetch' | 'xhr';

export type RequestStart = {
    kind: RequestKind;
    method: string;
    /** Exactly what the caller passed, so it can be a relative path. */
    url: string;
    /** Fetch only. Kept so the mutator can read headers off a `Request` object. */
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

export type RequestSubscriber = (start: RequestStart) => RequestHandlers | void;

/** fetch applies `init`, XHR applies `headers`. */
export type MutatedRequest = { init?: RequestInit; headers?: Record<string, string> };

export type RequestMutator = (start: RequestStart) => (RequestHandlers & MutatedRequest) | void;

const subscribers = new Set<RequestSubscriber>();
let mutator: RequestMutator | null = null;

export function subscribeToRequests(subscriber: RequestSubscriber): () => void {
    subscribers.add(subscriber);
    return () => {
        subscribers.delete(subscriber);
    };
}

// The newest claim wins: after HMR re-runs the start-up code, the old owner is dead and must not
// keep the slot.
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

export function hasRequestSubscribers(): boolean {
    return subscribers.size > 0 || mutator !== null;
}

// Test helper. The SDK never calls this.
export function resetRequestBus(): void {
    subscribers.clear();
    mutator = null;
}

/**
 * Tells every subscriber a request is about to go out. Returns the (possibly mutated) `init` and
 * `headers` plus one `settle` callback that fans the result out to every subscriber. Returns null
 * when nothing acted on the request; the wrapper must then call the real fetch or send untouched.
 * A subscriber that throws is skipped, so instrumentation never breaks the app's request.
 */
export function publishRequestStart(start: RequestStart): {
    settle(result: RequestSettle): void;
    init: RequestInit | undefined;
    headers: Record<string, string> | undefined;
} | null {
    const handlers: RequestHandlers[] = [];

    for (const subscriber of subscribers) {
        try {
            const handler = subscriber(start);
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
        } catch {}
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
