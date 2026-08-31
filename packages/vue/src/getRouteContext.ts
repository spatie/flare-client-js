import { redactObjectValues, redactUrlQuery as redactFullPath } from '@flareapp/core';

import { DEFAULT_PROPS_DENYLIST } from './constants';
import { serializeProps } from './serializeProps';
import type { RouteContext, RouteParamValue, RouteQueryValue } from './types';

type GetRouteContextOptions = {
    denylist?: RegExp;
};

const ROUTE_PARAMS_DEPTH = 2;

// vue-router allows a symbol route name; neither shape survives JSON, so convert both to a string.
function routeNameOf(value: unknown): string | null {
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'symbol') {
        return value.toString();
    }
    return null;
}

function matchedNames(matched: unknown): string[] {
    if (!Array.isArray(matched)) {
        return [];
    }
    return matched.map((record: unknown) => {
        if (!record || typeof record !== 'object') {
            return 'unknown';
        }
        return routeNameOf((record as Record<string, unknown>).name) ?? 'unknown';
    });
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object') {
        return {};
    }
    return value as Record<string, unknown>;
}

// `router` is `unknown` because vue-router is an optional peer — importing it would force every
// consumer to install it, and its runtime shape can differ across v4.x patches. The guards read
// defensively, so a missing or shimmed router returns `null` instead of throwing.
export function getRouteContext(router: unknown, options: GetRouteContextOptions = {}): RouteContext | null {
    if (!router || typeof router !== 'object' || !('currentRoute' in router)) {
        return null;
    }

    const currentRouteRef = (router as { currentRoute: unknown }).currentRoute;

    if (!currentRouteRef || typeof currentRouteRef !== 'object' || !('value' in currentRouteRef)) {
        return null;
    }

    const route = (currentRouteRef as { value: unknown }).value;

    if (!route || typeof route !== 'object') {
        return null;
    }

    const r = route as Record<string, unknown>;
    const denylist = options.denylist ?? DEFAULT_PROPS_DENYLIST;

    // Redact denylisted top-level keys via the shared core helper; serializeProps still size-bounds
    // and walks nested values.
    const redactedParams = redactObjectValues(recordOrEmpty(r.params), denylist);
    const redactedQuery = redactObjectValues(recordOrEmpty(r.query), denylist);

    return {
        name: routeNameOf(r.name),
        path: typeof r.path === 'string' ? r.path : '',
        fullPath: typeof r.fullPath === 'string' ? redactFullPath(r.fullPath, denylist) : '',
        params: serializeProps(redactedParams, ROUTE_PARAMS_DEPTH, denylist) as Record<string, RouteParamValue>,
        query: serializeProps(redactedQuery, ROUTE_PARAMS_DEPTH, denylist) as Record<
            string,
            RouteQueryValue | RouteQueryValue[]
        >,
        hash: typeof r.hash === 'string' ? r.hash : '',
        matched: matchedNames(r.matched),
    };
}
