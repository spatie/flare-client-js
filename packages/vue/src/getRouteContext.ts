import { DEFAULT_PROPS_DENYLIST } from './constants';
import { serializeProps } from './serializeProps';
import type { RouteContext, RouteParamValue, RouteQueryValue } from './types';

type GetRouteContextOptions = {
    denylist?: RegExp;
};

const ROUTE_PARAMS_DEPTH = 2;

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
    const name = r.name;
    const denylist = options.denylist ?? DEFAULT_PROPS_DENYLIST;

    const params = r.params && typeof r.params === 'object' ? (r.params as Record<string, unknown>) : {};
    const query = r.query && typeof r.query === 'object' ? (r.query as Record<string, unknown>) : {};

    return {
        name: typeof name === 'string' ? name : typeof name === 'symbol' ? name.toString() : null,
        path: typeof r.path === 'string' ? r.path : '',
        fullPath: typeof r.fullPath === 'string' ? redactFullPath(r.fullPath, denylist) : '',
        params: serializeProps(params, ROUTE_PARAMS_DEPTH, denylist) as Record<string, RouteParamValue>,
        query: serializeProps(query, ROUTE_PARAMS_DEPTH, denylist) as Record<
            string,
            RouteQueryValue | RouteQueryValue[]
        >,
        hash: typeof r.hash === 'string' ? r.hash : '',
        matched: Array.isArray(r.matched)
            ? r.matched.map((record: unknown) => {
                  if (!record || typeof record !== 'object') {
                      return 'unknown';
                  }

                  const n = (record as Record<string, unknown>).name;

                  return typeof n === 'string' ? n : typeof n === 'symbol' ? n.toString() : 'unknown';
              })
            : [],
    };
}

function redactFullPath(fullPath: string, denylist: RegExp): string {
    const queryStart = fullPath.indexOf('?');

    if (queryStart === -1) {
        return fullPath;
    }

    const hashStart = fullPath.indexOf('#', queryStart);
    const queryEnd = hashStart === -1 ? fullPath.length : hashStart;

    const prefix = fullPath.slice(0, queryStart + 1);
    const queryString = fullPath.slice(queryStart + 1, queryEnd);
    const suffix = fullPath.slice(queryEnd);

    const redacted = queryString
        .split('&')
        .map((pair) => {
            if (pair === '') {
                return pair;
            }

            const eq = pair.indexOf('=');
            const rawKey = eq === -1 ? pair : pair.slice(0, eq);
            const decodedKey = safeDecode(rawKey);

            if (!denylist.test(decodedKey)) {
                return pair;
            }

            return eq === -1 ? rawKey : `${rawKey}=[Redacted]`;
        })
        .join('&');

    return `${prefix}${redacted}${suffix}`;
}

function safeDecode(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}
