import type { Attributes } from '@flareapp/core';

/**
 * Case-insensitively look up a header value. Returns the first defined value
 * for the lowercased name, or undefined. Array values (rare but valid for
 * some headers) are coalesced to the first element since the consumers in
 * this package treat the value as scalar.
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
 * Default-redacted header names. The pattern is anchored to the FULL header
 * name (`^...$`) and case-insensitive so it catches `Authorization`,
 * `AUTHORIZATION`, `authorization`, etc. Anchoring matters: an unanchored
 * `cookie` would match `X-Some-Cookie-Hint` too, which we do NOT want — only
 * the exact header by name should be redacted by default.
 *
 * Covers the usual credential carriers (`authorization`, `cookie`, etc) plus
 * common proxy-set headers that often expose client IPs (`forwarded`,
 * `x-forwarded-for`, `x-forwarded-user`). Users add domain-specific entries
 * via `configureNode({ headerDenylist: ... })`.
 */
export const DEFAULT_HEADER_DENYLIST =
    /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-csrf-token|x-xsrf-token|x-auth-token|forwarded|x-forwarded-(?:for|user))$/i;

/**
 * Combine the built-in denylist with an optional user-supplied one.
 *
 * - No custom regex          -> use the default as-is.
 * - Custom + replace = true  -> use only the custom pattern (with `g`/`y`
 *                               flags stripped so `.test()` stays stateless).
 * - Custom + replace = false -> union: `(?:default)|(?:custom)`, forcing case
 *                               insensitivity since header names are
 *                               case-insensitive over the wire.
 */
export function resolveHeaderDenylist(custom?: RegExp, replaceDefault = false): RegExp {
    if (!custom) return DEFAULT_HEADER_DENYLIST;
    if (replaceDefault) return new RegExp(custom.source, custom.flags.replace(/[gy]/g, ''));
    return new RegExp(`(?:${DEFAULT_HEADER_DENYLIST.source})|(?:${custom.source})`, 'i');
}

/**
 * Project an HTTP request `headers` object into report attributes.
 *
 * Behavior per header:
 *
 * - **Unset values** (entry exists but the value is `undefined`) are dropped
 *   entirely — `node:http` represents "header was not sent" this way.
 * - **Names are lowercased.** OTel's attribute convention uses lowercase
 *   header keys, and HTTP header names are case-insensitive anyway.
 * - **Allowlist gate.** If `headerAllowlist` is set, only headers whose
 *   lowercased name matches are emitted; everything else is silently dropped
 *   (NOT redacted, dropped). This is the strongest filter — useful for
 *   compliance scenarios where you must opt into headers explicitly.
 * - **Array values** (`set-cookie` can be `string[]`) are joined with `, ` so
 *   the emitted value is a flat string, matching the on-the-wire shape that
 *   most HTTP clients render.
 * - **Denylist redaction.** If the name matches `headerDenylist`, the value
 *   is replaced with `'[redacted]'` (the key still appears so consumers can
 *   tell the header was present).
 *
 * Output keys are `http.request.header.<lowercased-name>`, per OTel.
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
