import type { Attributes } from '@flareapp/core';

/**
 * Case-insensitively look up a header value. Returns the first defined match, or undefined. Array values
 * are coalesced to the first element since consumers here treat the value as scalar.
 */
export function findHeader(
    headers: Record<string, string | string[] | undefined> | undefined,
    name: string,
): string | undefined {
    if (!headers) return undefined;
    const target = name.toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() !== target) continue;
        if (value === undefined) continue;
        return Array.isArray(value) ? value[0] : value;
    }
    return undefined;
}

/**
 * Default-redacted header names. Anchored to the full name (`^...$`) and case-insensitive: anchoring is
 * load-bearing so an unanchored `cookie` doesn't also match `X-Some-Cookie-Hint`. Covers credential
 * carriers plus proxy headers that expose client IPs. Users extend via `configureNode({ headerDenylist })`.
 */
export const DEFAULT_HEADER_DENYLIST =
    /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-csrf-token|x-xsrf-token|x-auth-token|forwarded|x-forwarded-(?:for|user))$/i;

/**
 * Combine the built-in denylist with an optional custom one.
 * - No custom: the default as-is.
 * - Custom + replace: only the custom pattern (`g`/`y` stripped so `.test()` stays stateless).
 * - Custom + no replace: union `(?:default)|(?:custom)`, forced case-insensitive (header names are).
 */
export function resolveHeaderDenylist(custom?: RegExp, replaceDefault = false): RegExp {
    if (!custom) return DEFAULT_HEADER_DENYLIST;
    if (replaceDefault) return new RegExp(custom.source, custom.flags.replace(/[gy]/g, ''));
    return new RegExp(`(?:${DEFAULT_HEADER_DENYLIST.source})|(?:${custom.source})`, 'i');
}

/**
 * Project an HTTP request `headers` object into report attributes, keyed `http.request.header.<name>`.
 *
 * Per header:
 * - Unset values (`undefined`) are dropped; `node:http` represents "not sent" this way.
 * - Names are lowercased (OTel convention; header names are case-insensitive anyway).
 * - Allowlist gate: if `headerAllowlist` is set, non-matching headers are dropped (not redacted). The
 *   strongest filter, for compliance opt-in.
 * - Array values (e.g. `set-cookie: string[]`) are joined with `, `.
 * - Denylist redaction: matching names get value `'[redacted]'` (key still appears so presence is known).
 */
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
