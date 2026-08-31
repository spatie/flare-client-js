// Marks a request the SDK makes for itself (for example, fetching a source file for a stack-trace
// snippet). The fetch patch passes these through untraced: they are not the app's traffic, so a span
// or a `traceparent` on them would be wrong.
//
// Flare's ingest calls are excluded by URL instead (`isFlareIngestUrl`), because those endpoints are
// known ahead of time. A snippet fetch targets the customer's own asset, so only the caller knows.
export const INTERNAL_REQUEST_KEY = '__flare_internal_request__';

export type InternalRequestInit = RequestInit & { [INTERNAL_REQUEST_KEY]?: true };

// An init that marks the request as Flare's own. Unknown init keys are ignored by `fetch`.
export function internalRequestInit(init?: RequestInit): InternalRequestInit {
    return { ...init, [INTERNAL_REQUEST_KEY]: true };
}

export function isInternalRequest(init: RequestInit | undefined): boolean {
    return (init as InternalRequestInit | undefined)?.[INTERNAL_REQUEST_KEY] === true;
}
