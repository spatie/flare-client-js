import { DEFAULT_URL_DENYLIST } from '@flareapp/core';

/** `^` plus `\b` accepts a `; charset=utf-8` suffix while still rejecting `...-urlencoded-foo`. */
export const DEFAULT_BODY_CONTENT_TYPES = /^application\/(json|x-www-form-urlencoded)\b/i;

/** Reuses core's URL denylist, so credentials are caught by the same regex everywhere. */
export const DEFAULT_BODY_KEY_DENYLIST = DEFAULT_URL_DENYLIST;

type BodyOptions = {
    bodyAllowedContentTypes: RegExp;
    bodyKeyDenylist: RegExp;
    bodyMaxBytes: number;
};

/**
 * Normalize, redact, serialize, and size-cap a request body for a Flare report. Returns the JSON string,
 * or `null` when the body should not be reported (unknown shape, content-type miss, serialization fail).
 *
 * Accepts four runtime shapes:
 * - `string`: must match `contentType` per `bodyAllowedContentTypes`, else dropped.
 * - `Buffer`: decoded UTF-8 then treated as a string.
 * - `URLSearchParams`: flattened to a plain record. No content-type gate (shape is unambiguous).
 * - Other `object`/array: used as-is, no gate. The common middleware path (Express/Fastify `req.body`).
 * Anything else returns `null`.
 *
 * Then: redact (denylisted keys become `'[redacted]'`, cycles become `'[Circular]'`), `JSON.stringify`
 * (drop body if it throws on BigInt/Symbol/etc), and truncate to `bodyMaxBytes` including the suffix.
 */
export function captureBody(body: unknown, contentType: string | undefined, opts: BodyOptions): string | null {
    if (body === undefined || body === null) {
        return null;
    }

    let parsed: unknown;
    if (typeof body === 'string') {
        if (!matchesContentType(contentType, opts.bodyAllowedContentTypes)) {
            return null;
        }
        parsed = parseString(body, contentType);
        if (parsed === undefined) {
            return null;
        }
    } else if (Buffer.isBuffer(body)) {
        if (!matchesContentType(contentType, opts.bodyAllowedContentTypes)) {
            return null;
        }
        parsed = parseString(body.toString('utf8'), contentType);
        if (parsed === undefined) {
            return null;
        }
    } else if (body instanceof URLSearchParams) {
        parsed = Object.fromEntries(body.entries());
    } else if (Array.isArray(body) || isPlainObject(body)) {
        parsed = body;
    } else {
        return null;
    }

    const redacted = redact(parsed, opts.bodyKeyDenylist);
    let serialized: string;
    try {
        serialized = JSON.stringify(redacted);
    } catch {
        return null;
    }
    return truncateToByteLimit(serialized, opts.bodyMaxBytes);
}

const TRUNCATION_SUFFIX = '…[truncated]';
const TRUNCATION_SUFFIX_BYTES = Buffer.byteLength(TRUNCATION_SUFFIX, 'utf8');

/** Walks back over continuation bytes (`10xxxxxx`) to a codepoint boundary, so the result still decodes. */
function truncateToByteLimit(serialized: string, maxBytes: number): string {
    const buf = Buffer.from(serialized, 'utf8');
    if (buf.length <= maxBytes) {
        return serialized;
    }
    if (maxBytes <= TRUNCATION_SUFFIX_BYTES) {
        // Budget too small for suffix plus payload: emit the suffix truncated to budget at a codepoint
        // boundary.
        const suffixBuf = Buffer.from(TRUNCATION_SUFFIX, 'utf8');
        let cut = maxBytes;
        while (cut > 0 && (suffixBuf[cut] & 0xc0) === 0x80) {
            cut--;
        }
        return suffixBuf.subarray(0, cut).toString('utf8');
    }
    let cut = maxBytes - TRUNCATION_SUFFIX_BYTES;
    while (cut > 0 && (buf[cut] & 0xc0) === 0x80) {
        cut--;
    }
    return buf.subarray(0, cut).toString('utf8') + TRUNCATION_SUFFIX;
}

/** Normalizes to the bare media type first, so a strict custom regex like `/^application\/json$/` still
 *  matches `application/json; charset=utf-8`. */
function matchesContentType(ct: string | undefined, allowed: RegExp): boolean {
    if (!ct) {
        return false;
    }
    const mediaType = ct.split(';')[0].trim().toLowerCase();
    if (!mediaType) {
        return false;
    }
    return allowed.test(mediaType);
}

/** Returns `undefined` rather than `null` on failure, since `null` is itself a valid JSON value. */
function parseString(text: string, contentType?: string): unknown {
    if (contentType && /x-www-form-urlencoded/i.test(contentType)) {
        return Object.fromEntries(new URLSearchParams(text).entries());
    }
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
}

/** Excludes class instances, streams, FormData, ArrayBuffer views, Buffer and URLSearchParams. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== 'object') {
        return false;
    }
    const proto = Object.getPrototypeOf(value);
    return proto === null || proto === Object.prototype;
}

/** `seen` is a parameter rather than a closure to avoid allocating a WeakSet per recursion. */
function redact(value: unknown, denylist: RegExp, seen: WeakSet<object> = new WeakSet()): unknown {
    if (value === null || typeof value !== 'object') {
        return value;
    }
    if (seen.has(value as object)) {
        return '[Circular]';
    }
    seen.add(value as object);
    if (Array.isArray(value)) {
        return value.map((v) => redact(v, denylist, seen));
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
        out[k] = denylist.test(k) ? '[redacted]' : redact(v, denylist, seen);
    }
    return out;
}
