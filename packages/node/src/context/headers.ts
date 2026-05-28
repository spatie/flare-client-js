import type { Attributes } from '@flareapp/core';

export const DEFAULT_HEADER_DENYLIST =
    /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-csrf-token|x-xsrf-token|x-auth-token|forwarded|x-forwarded-(?:for|user))$/i;

export function resolveHeaderDenylist(custom?: RegExp, replaceDefault = false): RegExp {
    if (!custom) return DEFAULT_HEADER_DENYLIST;
    if (replaceDefault) return new RegExp(custom.source, custom.flags.replace(/[gy]/g, ''));
    return new RegExp(`(?:${DEFAULT_HEADER_DENYLIST.source})|(?:${custom.source})`, 'i');
}

export function projectHeaders(
    headers: Record<string, string | string[] | undefined> | undefined,
    options: { headerDenylist: RegExp; headerAllowlist: RegExp | null },
): Attributes {
    const out: Attributes = {};
    if (!headers) return out;
    for (const [rawName, rawValue] of Object.entries(headers)) {
        if (rawValue === undefined) continue;
        const name = rawName.toLowerCase();
        if (options.headerAllowlist && !options.headerAllowlist.test(name)) continue;
        const value = Array.isArray(rawValue) ? rawValue.join(', ') : rawValue;
        out[`http.request.header.${name}`] = options.headerDenylist.test(name) ? '[redacted]' : value;
    }
    return out;
}
