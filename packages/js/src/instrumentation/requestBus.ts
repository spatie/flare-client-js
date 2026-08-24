import type { FetchInput } from '../tracing/propagation';

export type RequestKind = 'fetch' | 'xhr';

/** What a consumer learns when a request is about to go out. */
export type RequestStart = {
    kind: RequestKind;
    method: string;
    /** As the caller gave it, so it may be relative. */
    url: string;
    /** Fetch only: the raw first argument, which `mergeTraceparentHeader` needs to merge headers correctly. */
    input?: FetchInput;
    /** Fetch only. */
    init?: RequestInit;
};

/** What a consumer learns when the request finished. `status` is absent when it never got a response. */
export type RequestSettle = {
    status?: number;
    error?: unknown;
};

/** What a consumer hands back per request. Closing over the start beats correlating by id. */
export type RequestHandlers = {
    onSettle?(settle: RequestSettle): void;
};

export type RequestObserver = (start: RequestStart) => RequestHandlers | void;

/**
 * The mutation slot's callback. Same as an observer, plus a replacement init. Only the slot holder can
 * return one, which is what stops a breadcrumb recorder from changing an outgoing request: the ability
 * is a property of the type, not of a code review.
 */
export type RequestMutator = (start: RequestStart) => (RequestHandlers & { init?: RequestInit }) | void;

const observers = new Set<RequestObserver>();
let mutator: RequestMutator | null = null;

/** Anything published to the bus reaches every subscriber. None of them can change the request. */
export function subscribeToRequests(observer: RequestObserver): () => void {
    observers.add(observer);
    return () => {
        observers.delete(observer);
    };
}

/**
 * Claim the one slot that may rewrite an outgoing request. Only tracing claims it, for `traceparent`.
 *
 * Last wins, because Vite HMR re-runs boot code against a `window.fetch` that survived the reload, and
 * first-wins would leave the stale holder in charge. The warning is not gated on `debug`: a second
 * claimant is always a fault, not noise.
 */
export function claimRequestMutation(owner: RequestMutator): () => void {
    if (mutator !== null) {
        console.warn(
            '%c FLARE %c Request mutation slot claimed twice.\n' +
                'The previous owner is now inactive, so outgoing requests may be missing their ' +
                'traceparent header. Two features are competing for the same request.',
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

/** True while anything would act on a published request. The patches use this to stay out of the way. */
export function hasRequestConsumers(): boolean {
    return observers.size > 0 || mutator !== null;
}

/** Test seam. Nothing in the SDK calls this. */
export function resetRequestBus(): void {
    observers.clear();
    mutator = null;
}

/**
 * Publish a start and collect what comes back. Returns the settle callbacks and the replacement init, if
 * the slot holder gave one.
 *
 * Null means nothing acted on this request: no settle handler and no replacement init. The caller must
 * then hand the request straight to the original, byte for byte. Wrapping a request nobody is watching
 * would still change it, because our path turns a synchronous throw from the host's fetch into a
 * rejected promise.
 *
 * Every callback runs inside its own try: instrumentation must never break the host, and one consumer
 * throwing must not rob the others of their settle handler.
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
        } catch {
            // one consumer's problem is not the request's problem
        }
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
            // losing the header only costs backend correlation
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
                } catch {
                    // never swallow the host's response or replace its rejection reason
                }
            }
        },
    };
}
