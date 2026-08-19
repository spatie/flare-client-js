/**
 * Marks a request the SDK makes for its own bookkeeping (right now: fetching a source file so a
 * stack frame can show a code snippet). The fetch patch passes those straight through: they are
 * not the app's traffic, so tracing them puts a span in the customer's waterfall for a request
 * their code never made, and propagating a `traceparent` on them is just as wrong.
 *
 * Flare's ingest calls are excluded by URL instead (`isFlareIngestUrl`), because their endpoints
 * are known up front. A snippet fetch targets the customer's own asset, so only the caller knows.
 */
export const INTERNAL_REQUEST_KEY = '__flare_internal_request__';

export type InternalRequestInit = RequestInit & { [INTERNAL_REQUEST_KEY]?: true };

/** An init that marks the request as Flare's own. Unknown init keys are ignored by `fetch`. */
export function internalRequestInit(init?: RequestInit): InternalRequestInit {
    return { ...init, [INTERNAL_REQUEST_KEY]: true };
}

export function isInternalRequest(init: RequestInit | undefined): boolean {
    return (init as InternalRequestInit | undefined)?.[INTERNAL_REQUEST_KEY] === true;
}
