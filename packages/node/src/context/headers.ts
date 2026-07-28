import type { Attributes } from '@flareapp/core';

/** Case-insensitive. Array values coalesce to the first element; consumers here want a scalar. */
export function findHeader(
    headers: Record<string, string | string[] | undefined> | undefined,
    name: string,
): string | undefined {
    if (!headers) {
        return undefined;
    }
    const target = name.toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() !== target) {
            continue;
        }
        if (value === undefined) {
            continue;
        }
        return Array.isArray(value) ? value[0] : value;
    }
    return undefined;
}

/** The `^...$` anchoring is load-bearing: an unanchored `cookie` would also match `X-Some-Cookie-Hint`. */
export const DEFAULT_HEADER_DENYLIST =
    /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-csrf-token|x-xsrf-token|x-auth-token|forwarded|x-forwarded-(?:for|user))$/i;

/** `g`/`y` are stripped from a custom pattern: those carry lastIndex, which makes `.test()` stateful. */
export function resolveHeaderDenylist(custom?: RegExp, replaceDefault = false): RegExp {
    if (!custom) {
        return DEFAULT_HEADER_DENYLIST;
    }
    if (replaceDefault) {
        return new RegExp(custom.source, custom.flags.replace(/[gy]/g, ''));
    }
    return new RegExp(`(?:${DEFAULT_HEADER_DENYLIST.source})|(?:${custom.source})`, 'i');
}

/**
 * Projects headers to `http.request.header.<name>` attributes. An allowlist drops a header entirely
 * (the compliance opt-in), while the denylist keeps the key and redacts the value, so its presence is
 * still visible. `undefined` is how `node:http` says "not sent", so those are dropped.
 */
export function projectHeaders(
    headers: Record<string, string | string[] | undefined> | undefined,
    options: { headerDenylist: RegExp; headerAllowlist: RegExp | null },
): Attributes {
    const out: Attributes = {};
    if (!headers) {
        return out;
    }
    for (const [rawName, rawValue] of Object.entries(headers)) {
        if (rawValue === undefined) {
            continue;
        }
        const name = rawName.toLowerCase();
        if (options.headerAllowlist && !options.headerAllowlist.test(name)) {
            continue;
        }
        const value = Array.isArray(rawValue) ? rawValue.join(', ') : rawValue;
        out[`http.request.header.${name}`] = options.headerDenylist.test(name) ? '[redacted]' : value;
    }
    return out;
}
