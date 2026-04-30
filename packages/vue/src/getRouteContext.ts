import { redactFullPath } from '@flareapp/js';

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
