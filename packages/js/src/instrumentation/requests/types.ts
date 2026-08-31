import type { FetchInput } from '../../tracing/requests/types';

export type RequestKind = 'fetch' | 'xhr';

export type RequestStart = {
    kind: RequestKind;
    method: string;
    // Exactly what the caller passed, so it can be a relative path.
    url: string;
    // Fetch only. Kept so the mutator can read headers off a `Request` object.
    input?: FetchInput;
    // Fetch only.
    init?: RequestInit;
};

export type RequestSettle = {
    // Not set when the request got no response.
    status?: number;
    error?: unknown;
    // XHR only. A second `open()` stops a request that still runs, and no DONE event follows.
    aborted?: boolean;
};

export type RequestHandlers = {
    onSettle?(settle: RequestSettle): void;
};

export type RequestSubscriber = (start: RequestStart) => RequestHandlers | void;

// fetch applies `init`, XHR applies `headers`.
export type MutatedRequest = { init?: RequestInit; headers?: Record<string, string> };

export type RequestMutator = (start: RequestStart) => (RequestHandlers & MutatedRequest) | void;
