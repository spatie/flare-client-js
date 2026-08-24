import type { FetchInput } from '../tracing/propagation';

export type RequestKind = 'fetch' | 'xhr';

export type RequestStart = {
    kind: RequestKind;
    method: string;
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
    /** XHR only. `open()` on an in-flight request kills it, and no DONE event follows. */
    aborted?: boolean;
};

export type RequestHandlers = {
    onSettle?(settle: RequestSettle): void;
};

export type RequestObserver = (start: RequestStart) => RequestHandlers | void;

/** `init` reaches fetch, `headers` reaches XHR. Each transport reads the one it can apply. */
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
 * The last claim wins: Vite HMR runs boot code again against the `fetch` that survived the reload,
 * and first-wins would leave the stale owner in charge.
 */
export function claimRequestMutation(owner: RequestMutator): () => void {
    if (mutator !== null) {
        console.warn(
            '%c FLARE %c\n\n' +
                'What: two things tried to add headers to outgoing requests. Only one can.\n\n' +
                'Why it matters: the first one stopped. Requests can now go out without a ' +
                'traceparent header, so Flare cannot link a browser request to its server trace.\n\n' +
                'How to fix: use one Flare instance, and check your bundle for two copies of ' +
                '@flareapp/js.',
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
            // A lost header only costs backend correlation.
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
