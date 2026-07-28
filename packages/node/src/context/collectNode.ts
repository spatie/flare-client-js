import type { Attributes, Config, ContextCollector } from '@flareapp/core';
import { redactUrlQuery } from '@flareapp/core';

import type { AsyncLocalStorageScopeProvider } from '../scope/AsyncLocalStorageScopeProvider';
import type { ResolvedNodeOptions } from '../types';
import { captureBody } from './body';
import { findHeader, projectHeaders } from './headers';
import { collectProcessAttributes } from './process';

/**
 * Projects process info (always) and the active request scope (only inside `runWithContext`) into
 * OTel-style attributes. User identity is not projected here: `Flare.setUser` writes straight to
 * `pendingAttributes`.
 *
 * `getOptions` is a getter so `configureNode(...)` shows up on later reports without rebuilding this.
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

        const scope = provider.active();
        const { request } = scope;

        if (request.method) {
            attrs['http.request.method'] = request.method;
        }

        // `request.path` has the shape of `req.url` from `node:http`: server-relative, optional query.
        // Redacting the whole path and slicing the prefix back off reuses core's `redactUrlQuery` rather
        // than reimplementing query redaction here.
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

        // The absolute URL when the caller has it, post proxy/host resolution. Independent of
        // `request.path`: either, both or neither may be set.
        if (request.url) {
            attrs['url.full'] = redactUrlQuery(request.url, config.urlDenylist);
        }

        // Already sanitized by `configureNode`, so used directly.
        const opts = getOptions();
        Object.assign(attrs, projectHeaders(request.headers, opts));

        // `findHeader` because header names are case-insensitive while `request.headers` is a plain Record.
        if (opts.captureRequestBody) {
            const contentType = findHeader(request.headers, 'content-type');
            const body = captureBody(request.body, contentType, opts);
            if (body !== null) {
                attrs['http.request.body'] = body;
            }
        }

        return attrs;
    };
}
