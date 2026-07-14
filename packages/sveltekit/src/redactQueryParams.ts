import { DEFAULT_URL_DENYLIST } from '@flareapp/js';

export function redactQueryParams(searchParams: URLSearchParams): Record<string, string> {
    const result: Record<string, string> = {};

    searchParams.forEach((value, key) => {
        result[key] = DEFAULT_URL_DENYLIST.test(key) ? '[redacted]' : value;
    });

    return result;
}

/** Redacts route-param values whose key matches the denylist, mirroring `redactQueryParams`. */
export function redactParams(params: Record<string, string>): Record<string, string> {
    const result: Record<string, string> = {};

    for (const key of Object.keys(params)) {
        result[key] = DEFAULT_URL_DENYLIST.test(key) ? '[redacted]' : params[key];
    }

    return result;
}
