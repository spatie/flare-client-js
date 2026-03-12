import type { RouteContext } from './types';

export function getRouteContext(router: unknown): RouteContext | null {
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

    return {
        name: typeof name === 'string' ? name : typeof name === 'symbol' ? name.toString() : null,
        path: typeof r.path === 'string' ? r.path : '',
        fullPath: typeof r.fullPath === 'string' ? r.fullPath : '',
        params: (r.params && typeof r.params === 'object' ? r.params : {}) as Record<string, unknown>,
        query: (r.query && typeof r.query === 'object' ? r.query : {}) as Record<string, unknown>,
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
