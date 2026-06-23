import type { Attributes, Config, ContextCollector } from '@flareapp/core';
import { redactUrlQuery } from '@flareapp/core';

import type { AsyncLocalStorageScopeProvider } from '../scope/AsyncLocalStorageScopeProvider';
import type { ResolvedNodeOptions } from '../types';
import { captureBody } from './body';
import { findHeader, projectHeaders } from './headers';
import { collectProcessAttributes } from './process';

/**
 * Build the Node-side `ContextCollector` that core's `Flare` calls on every
 * report. The returned function projects two sources into OTel-style report
 * attributes:
 *
 * 1. **Process info** — runtime version, pid, hostname, etc. Always present.
 * 2. **Active request scope** — method, path/url (with query-string keys
 *    redacted), headers (with the denylist applied), and optional body. Present
 *    when `runWithContext(...)` is active; falls back to the shared scope
 *    otherwise (no request attrs emitted then). User identity is no longer
 *    projected here: `Flare.setUser` writes it straight to `pendingAttributes`.
 *
 * Both `provider` and `getOptions` are passed in (not captured by reference to
 * concrete instances) so the closure stays decoupled from `NodeFlare`'s
 * internals. `getOptions` is a getter (not a value) so that `configureNode(...)`
 * changes are visible on subsequent reports without rebuilding the collector.
 *
 * The function returned matches `ContextCollector = (config) => Attributes`,
 * which is core's interface for `Flare`'s third constructor parameter.
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

        // Pull the active scope (either the per-request NodeScope inside a
        // runWithContext callback, or the shared fallback outside one). Either
        // way `request` is a real RequestContext object; unset fields are just
        // `undefined`.
        const scope = provider.active();
        const { request } = scope;

        if (request.method) attrs['http.request.method'] = request.method;

        // `request.path` is a server-relative path with an optional query
        // string (the shape of `req.url` from `node:http`). Project to:
        // - `url.path`: everything before `?`
        // - `url.query`: everything after `?`, with denylisted keys redacted
        //
        // We piggy-back on core's `redactUrlQuery` (which expects a full path
        // or URL with `?`) by passing the whole `request.path` and then
        // slicing off the prefix back out of the result. Avoids reimplementing
        // the redact-query logic in two places.
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

        // `request.url` is the absolute URL when the caller has it (after
        // proxy/host resolution). Goes to `url.full` with its query string
        // redacted. Independent of `request.path` — callers can set either,
        // both, or neither.
        if (request.url) {
            attrs['url.full'] = redactUrlQuery(request.url, config.urlDenylist);
        }

        // Fetch the live node options once per call. `headerDenylist`,
        // `headerAllowlist`, body settings — all already-sanitized by
        // `configureNode`, so we can use them directly.
        const opts = getOptions();
        Object.assign(attrs, projectHeaders(request.headers, opts));

        // Body capture is off by default. When on, look up `content-type`
        // case-insensitively (HTTP header names are case-insensitive but
        // `request.headers` is just a Record so callers may use either case).
        // `captureBody` returns null when the content type isn't allowed,
        // the body is missing, or serialization fails; we only emit the
        // attribute when there's something to emit.
        if (opts.captureRequestBody) {
            const contentType = findHeader(request.headers, 'content-type');
            const body = captureBody(request.body, contentType, opts);
            if (body !== null) attrs['http.request.body'] = body;
        }

        return attrs;
    };
}
