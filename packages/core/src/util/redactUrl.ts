// Matched against query-string keys, cookie names, and (in framework SDKs) prop/route-param keys. Values for
// matching keys are replaced with [redacted] before sending so credentials/PII don't leak in error reports.
export const DEFAULT_URL_DENYLIST =
    /password|passwd|pwd|token|secret|authorization|\bauth\b|bearer|oauth|credentials?|cookie|api[-_]?key|private[-_]?key|session|csrf|xsrf|\bpin\b|\bssn\b|card[-_]?number|\bcvv\b/i;

export function resolveDenylist(
    custom?: RegExp,
    replaceDefault: boolean = false,
    defaultDenylist: RegExp = DEFAULT_URL_DENYLIST,
): RegExp {
    if (!custom) {
        return defaultDenylist;
    }

    if (replaceDefault) {
        const safeFlags = custom.flags.replace(/[gy]/g, '');
        return new RegExp(custom.source, safeFlags);
    }

    const flags = unionFlags(defaultDenylist.flags, custom.flags);

    return new RegExp(`(?:${defaultDenylist.source})|(?:${custom.source})`, flags);
}

function unionFlags(a: string, b: string): string {
    const merged = new Set<string>();

    for (const flag of a + b) {
        if (flag === 'g' || flag === 'y') {
            continue;
        }
        merged.add(flag);
    }

    return [...merged].join('');
}

/**
 * Strips userinfo (`user:pass@`) from an absolute URL and replaces query-string values whose key
 * matches `denylist` with `[redacted]`. Path segments are left untouched.
 */
export function redactUrlQuery(fullPath: string, denylist: RegExp = DEFAULT_URL_DENYLIST): string {
    const url = stripUserinfo(fullPath);
    const queryStart = url.indexOf('?');

    if (queryStart === -1) {
        return url;
    }

    const hashStart = url.indexOf('#', queryStart);
    const queryEnd = hashStart === -1 ? url.length : hashStart;

    const prefix = url.slice(0, queryStart + 1);
    const queryString = url.slice(queryStart + 1, queryEnd);
    const suffix = url.slice(queryEnd);

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

            return eq === -1 ? rawKey : `${rawKey}=[redacted]`;
        })
        .join('&');

    return `${prefix}${redacted}${suffix}`;
}

/**
 * Value-side mirror of `redactUrlQuery`: a new object where any value whose key matches `denylist`
 * becomes `[redacted]`. Null-prototype result so a `__proto__` key is stored, not swallowed.
 */
export function redactObjectValues(
    obj: Record<string, unknown>,
    denylist: RegExp = DEFAULT_URL_DENYLIST,
): Record<string, unknown> {
    const result: Record<string, unknown> = Object.create(null);

    for (const key of Object.keys(obj)) {
        result[key] = denylist.test(key) ? '[redacted]' : obj[key];
    }

    return result;
}

/**
 * Removes userinfo (`user:pass@`) from an absolute URL's authority only. A path or query can legally
 * contain `@`, so only the authority (after `scheme://`, up to the first `/`, `?`, `#`) is inspected.
 */
function stripUserinfo(url: string): string {
    const schemeMatch = /^[a-z][a-z0-9+.-]*:\/\//i.exec(url);

    if (!schemeMatch) {
        return url;
    }

    const authorityStart = schemeMatch[0].length;
    const rest = url.slice(authorityStart);
    const delimiter = /[/?#]/.exec(rest);
    const authorityEnd = delimiter ? authorityStart + delimiter.index : url.length;

    const authority = url.slice(authorityStart, authorityEnd);
    // The last `@` is the userinfo delimiter: neither userinfo nor host may contain an unescaped `@`,
    // and browsers treat the final one as the split when a malformed URL carries several.
    const at = authority.lastIndexOf('@');

    if (at === -1) {
        return url;
    }

    return url.slice(0, authorityStart) + authority.slice(at + 1) + url.slice(authorityEnd);
}

/**
 * decodeURIComponent throws on malformed escape sequences (`%E0`, lone `%`, etc). Falls back to the
 * raw key in that case rather than aborting the whole redaction pass.
 */
export function safeDecode(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}
