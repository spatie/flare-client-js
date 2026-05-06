// Matched against query-string keys (and, in framework SDKs, against prop/route-param keys).
// Values for matching keys are replaced with [redacted] before the data is sent to Flare so
// credentials/PII don't leak in error reports.
export const DEFAULT_URL_DENYLIST =
    /password|passwd|pwd|token|secret|authorization|\bauth\b|bearer|oauth|credentials?|cookie|api[-_]?key|private[-_]?key|session|csrf|xsrf|\bpin\b|\bssn\b|card[-_]?number|\bcvv\b/i;

export function resolveDenylist(
    custom?: RegExp,
    replaceDefault: boolean = false,
    defaultDenylist: RegExp = DEFAULT_URL_DENYLIST
): RegExp {
    if (!custom) {
        return defaultDenylist;
    }

    if (replaceDefault) {
        return custom;
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

export function redactFullPath(fullPath: string, denylist: RegExp = DEFAULT_URL_DENYLIST): string {
    const queryStart = fullPath.indexOf('?');

    if (queryStart === -1) {
        return fullPath;
    }

    const hashStart = fullPath.indexOf('#', queryStart);
    const queryEnd = hashStart === -1 ? fullPath.length : hashStart;

    const prefix = fullPath.slice(0, queryStart + 1);
    const queryString = fullPath.slice(queryStart + 1, queryEnd);
    const suffix = fullPath.slice(queryEnd);

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

// decodeURIComponent throws on malformed escape sequences (`%E0`, lone `%`, etc). Match against the
// raw key in that case rather than aborting the whole redaction pass.
function safeDecode(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}
