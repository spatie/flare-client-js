import type { Attributes } from '@flareapp/core';

/** Case-insensitive. An array value collapses to its first element; callers here want a single value. */
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

/** The `^` and `$` matter: without them, `cookie` would also match a header like `X-Some-Cookie-Hint`. */
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
 * Turns headers into `http.request.header.<name>` attributes. The two lists differ on purpose: an
 * allowlist drops a header entirely, for apps that may only send named headers, while the denylist
 * keeps the name and replaces the value, so you can still see the header was there. `undefined` is
 * how `node:http` says "not sent", so those are dropped.
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
