import type { Attributes, Config, ContextCollector } from '@flareapp/core';
import { redactUrlQuery } from '@flareapp/core';

import type { AsyncLocalStorageScopeProvider } from '../scope/AsyncLocalStorageScopeProvider';
import type { ResolvedNodeOptions } from '../types';
import { captureBody } from './body';
import { findHeader, projectHeaders } from './headers';
import { collectProcessAttributes } from './process';

/**
 * Build the Node-side `ContextCollector` that core's `Flare` calls per report. Projects two sources into
 * OTel-style attributes: process info (always present) and the active request scope (method, path/url
 * with query keys redacted, headers with denylist applied, optional body) when `runWithContext(...)` is
 * active. Outside a request it falls back to the shared scope and emits no request attrs. User identity
 * is not projected here; `Flare.setUser` writes straight to `pendingAttributes`.
 *
 * `getOptions` is a getter so `configureNode(...)` changes show up on later reports without rebuilding
 * the collector.
 */
export function makeNodeContextCollector(
    provider: AsyncLocalStorageScopeProvider,
    getOptions: () => Pick<
        ResolvedNodeOptions,
        | 'headerDenylist'
        | 'headerAllowlist'
        | 'captureRequestBody'
        | 'bodyAllowedContentTypes'
        | 'bodyKeyDenylist'
        | 'bodyMaxBytes'
    >,
): ContextCollector {
    return (config: Readonly<Config>): Attributes => {
        // Always-on baseline: server entry point + Node runtime info.
        const attrs: Attributes = {
            'flare.entry_point.type': 'server',
            ...collectProcessAttributes(),
        };

        // Active scope: per-request NodeScope inside runWithContext, or the shared fallback outside.
        // Either way `request` is a real RequestContext; unset fields are `undefined`.
        const scope = provider.active();
        const { request } = scope;

        if (request.method) attrs['http.request.method'] = request.method;

        // `request.path` is a server-relative path with optional query (the shape of `req.url` from
        // `node:http`). Split into `url.path` (before `?`) and `url.query` (after `?`, denylisted keys
        // redacted). We reuse core's `redactUrlQuery` by passing the whole path and slicing the prefix
        // back off, rather than reimplementing redact-query here.
        if (request.path) {
            const queryStart = request.path.indexOf('?');
            if (queryStart === -1) {
                attrs['url.path'] = request.path;
            } else {
                attrs['url.path'] = request.path.slice(0, queryStart);
                const redactedQuery = redactUrlQuery(request.path, config.urlDenylist);
                const redactedQueryStart = redactedQuery.indexOf('?');
                attrs['url.query'] = redactedQuery.slice(redactedQueryStart + 1);
            }
        }

        // `request.url` is the absolute URL when the caller has it (post proxy/host resolution). Goes to
        // `url.full` with its query redacted. Independent of `request.path`; either, both, or neither.
        if (request.url) {
            attrs['url.full'] = redactUrlQuery(request.url, config.urlDenylist);
        }

        // Live node options once per call; already sanitized by `configureNode`, so used directly.
        const opts = getOptions();
        Object.assign(attrs, projectHeaders(request.headers, opts));

        // Body capture off by default. When on, look up `content-type` case-insensitively (header names
        // are case-insensitive but `request.headers` is a plain Record). `captureBody` returns null when
        // the type isn't allowed, the body is missing, or serialization fails; only emit when non-null.
        if (opts.captureRequestBody) {
            const contentType = findHeader(request.headers, 'content-type');
            const body = captureBody(request.body, contentType, opts);
            if (body !== null) attrs['http.request.body'] = body;
        }

        return attrs;
    };
}
