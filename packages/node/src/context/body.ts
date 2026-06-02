import { DEFAULT_URL_DENYLIST } from '@flareapp/core';

/**
 * Content types accepted by default for body capture. JSON and
 * URL-encoded forms cover the vast majority of API payloads while keeping
 * the parser surface tiny. `\b` after the second alternative prevents
 * accidental matches like `application/x-www-form-urlencoded-foo` (artificial
 * but cheap to defend against). The leading `^` plus `\b` lets us match
 * either bare types or types with `; charset=utf-8` style suffixes.
 */
export const DEFAULT_BODY_CONTENT_TYPES = /^application\/(json|x-www-form-urlencoded)\b/i;

/**
 * Keys whose values get replaced with `[redacted]` during body redaction.
 * Reuses core's URL denylist so credentials, tokens, etc are caught with the
 * same regex everywhere (less surface for users to keep in sync).
 */
export const DEFAULT_BODY_KEY_DENYLIST = DEFAULT_URL_DENYLIST;

type BodyOptions = {
    bodyAllowedContentTypes: RegExp;
    bodyKeyDenylist: RegExp;
    bodyMaxBytes: number;
};

/**
 * Normalize, redact, serialize, and size-cap a request body for inclusion in
 * a Flare report.
 *
 * Accepts four runtime shapes (whatever the user hands us via
 * `runWithContext({ body, ... })`):
 *
 * - `string` — assumed to match the declared `contentType`. Must be JSON or
 *   form-encoded text per `bodyAllowedContentTypes`; otherwise dropped.
 * - `Buffer` — decoded as UTF-8 then treated like a string.
 * - `URLSearchParams` — flattened to a plain `Record<string, string>`. No
 *   content-type gate (the type is unambiguous from the shape).
 * - Other `object` (POJO, array) — used as-is, no content-type gate. This is
 *   the common middleware path (Express's `req.body`, Fastify's, etc).
 *
 * Anything else (`number`, `boolean`, class instance, stream) returns `null`
 * and the body is not reported.
 *
 * After parsing:
 *
 * 1. **Redact.** Walk the value, replacing any property whose key matches
 *    `bodyKeyDenylist` with `'[redacted]'`. Handles arrays, nested objects,
 *    and circular references (`WeakSet`-tracked, emits `'[Circular]'` on
 *    repeat sight).
 * 2. **Stringify.** `JSON.stringify`; if it throws (BigInt, Symbol, etc),
 *    drop the body entirely.
 * 3. **Truncate.** Cap at `bodyMaxBytes` UTF-8 bytes (the option's named
 *    semantic) INCLUDING the suffix. Truncation respects codepoint boundaries
 *    so the result decodes cleanly with no replacement characters.
 *
 * Returns the final JSON string, or `null` when the body should not be
 * reported (unknown shape, content-type miss, serialization failure).
 */
export function captureBody(body: unknown, contentType: string | undefined, opts: BodyOptions): string | null {
    if (body === undefined || body === null) return null;

    let parsed: unknown;
    if (typeof body === 'string') {
        if (!matchesContentType(contentType, opts.bodyAllowedContentTypes)) return null;
        parsed = parseString(body, contentType);
        if (parsed === undefined) return null;
    } else if (Buffer.isBuffer(body)) {
        if (!matchesContentType(contentType, opts.bodyAllowedContentTypes)) return null;
        parsed = parseString(body.toString('utf8'), contentType);
        if (parsed === undefined) return null;
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

/**
 * Truncate a serialized string so the resulting UTF-8 byte length never
 * exceeds `maxBytes`, including the appended truncation suffix.
 *
 * Walks backwards from the budget index while the byte at that position is a
 * UTF-8 continuation byte (`10xxxxxx`), stopping at the first byte that
 * starts a new codepoint. Slicing at that index leaves a buffer that decodes
 * cleanly with no replacement characters.
 */
function truncateToByteLimit(serialized: string, maxBytes: number): string {
    const buf = Buffer.from(serialized, 'utf8');
    if (buf.length <= maxBytes) return serialized;
    if (maxBytes <= TRUNCATION_SUFFIX_BYTES) {
        // Budget too small to fit the suffix plus any payload. Emit the suffix
        // truncated to the byte budget, respecting codepoint boundaries.
        const suffixBuf = Buffer.from(TRUNCATION_SUFFIX, 'utf8');
        let cut = maxBytes;
        while (cut > 0 && (suffixBuf[cut] & 0xc0) === 0x80) cut--;
        return suffixBuf.subarray(0, cut).toString('utf8');
    }
    let cut = maxBytes - TRUNCATION_SUFFIX_BYTES;
    while (cut > 0 && (buf[cut] & 0xc0) === 0x80) cut--;
    return buf.subarray(0, cut).toString('utf8') + TRUNCATION_SUFFIX;
}

/**
 * Check whether a `content-type` header is on the allowlist. Normalizes to the
 * bare media type first: strips any parameters (`; charset=utf-8`), trims, and
 * lowercases, so the regex is tested against `application/json` rather than the
 * full header. This lets a strict custom regex like `/^application\/json$/`
 * still match `application/json; charset=utf-8`. Empty/missing is a hard miss.
 */
function matchesContentType(ct: string | undefined, allowed: RegExp): boolean {
    if (!ct) return false;
    const mediaType = ct.split(';')[0].trim().toLowerCase();
    if (!mediaType) return false;
    return allowed.test(mediaType);
}

/**
 * Parse a serialized body string into a JS value, branching on the declared
 * content type.
 *
 * - URL-encoded forms become a flat object so the same `redact` walker works.
 * - Otherwise treat as JSON. Returns `undefined` (NOT `null`, which is a
 *   legitimate JSON value) when parsing fails, so the caller can distinguish
 *   "couldn't parse" from "parsed to literal null".
 */
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

/**
 * True only for `Object.create(null)` or `{}`-shaped values. Excludes class
 * instances (their prototype chain points somewhere other than Object.prototype
 * or null), streams, FormData, ArrayBuffer views, Buffer, URLSearchParams,
 * and other built-ins that happen to be `typeof === 'object'`.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== 'object') return false;
    const proto = Object.getPrototypeOf(value);
    return proto === null || proto === Object.prototype;
}

/**
 * Recursively walk `value`, replacing values for denylisted keys with
 * `'[redacted]'` and substituting `'[Circular]'` for any object visited more
 * than once.
 *
 * `seen` is a `WeakSet` of already-visited objects. Carried as a parameter
 * (rather than a closure variable) so the same recursive call can pass it
 * down without per-call allocation.
 *
 * Primitives and `null` pass through unchanged. Arrays preserve order;
 * objects preserve keys.
 */
function redact(value: unknown, denylist: RegExp, seen: WeakSet<object> = new WeakSet()): unknown {
    if (value === null || typeof value !== 'object') return value;
    if (seen.has(value as object)) return '[Circular]';
    seen.add(value as object);
    if (Array.isArray(value)) return value.map((v) => redact(v, denylist, seen));
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
        out[k] = denylist.test(k) ? '[redacted]' : redact(v, denylist, seen);
    }
    return out;
}
