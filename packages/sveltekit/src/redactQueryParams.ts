import { DEFAULT_URL_DENYLIST } from '@flareapp/js';

export function redactQueryParams(searchParams: URLSearchParams): Record<string, string> {
    const result: Record<string, string> = {};

    searchParams.forEach((value, key) => {
        result[key] = DEFAULT_URL_DENYLIST.test(key) ? '[redacted]' : value;
    });

    return result;
}
