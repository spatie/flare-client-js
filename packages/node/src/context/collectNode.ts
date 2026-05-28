import type { Attributes, Config, ContextCollector } from '@flareapp/core';
import { redactUrlQuery } from '@flareapp/core';

import type { AsyncLocalStorageScopeProvider } from '../scope/AsyncLocalStorageScopeProvider';
import type { ResolvedNodeOptions } from '../types';
import { captureBody } from './body';
import { projectHeaders } from './headers';
import { collectProcessAttributes } from './process';

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
        const attrs: Attributes = {
            'flare.entry_point.type': 'server',
            ...collectProcessAttributes(),
        };

        const scope = provider.active();
        const { request } = scope;

        if (request.method) attrs['http.request.method'] = request.method;

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

        if (request.url) {
            attrs['url.full'] = redactUrlQuery(request.url, config.urlDenylist);
        }

        const opts = getOptions();
        Object.assign(attrs, projectHeaders(request.headers, opts));

        if (opts.captureRequestBody) {
            const contentType = (request.headers?.['content-type'] ?? request.headers?.['Content-Type']) as
                | string
                | undefined;
            const body = captureBody(request.body, contentType, opts);
            if (body !== null) attrs['http.request.body'] = body;
        }

        if (scope.user) {
            if (scope.user.id !== undefined) attrs['enduser.id'] = String(scope.user.id);
            if (scope.user.email !== undefined) attrs['enduser.email'] = scope.user.email;
            if (scope.user.username !== undefined) attrs['enduser.username'] = scope.user.username;
            if (scope.user.ipAddress !== undefined) attrs['client.address'] = scope.user.ipAddress;
        }

        return attrs;
    };
}
