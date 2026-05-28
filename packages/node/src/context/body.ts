import { DEFAULT_URL_DENYLIST } from '@flareapp/core';

export const DEFAULT_BODY_CONTENT_TYPES = /^application\/(json|x-www-form-urlencoded)\b/i;
export const DEFAULT_BODY_KEY_DENYLIST = DEFAULT_URL_DENYLIST;

type BodyOptions = {
    bodyAllowedContentTypes: RegExp;
    bodyKeyDenylist: RegExp;
    bodyMaxBytes: number;
};

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
    } else if (typeof body === 'object') {
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
    if (serialized.length > opts.bodyMaxBytes) {
        return serialized.slice(0, opts.bodyMaxBytes) + '…[truncated]';
    }
    return serialized;
}

function matchesContentType(ct: string | undefined, allowed: RegExp): boolean {
    if (!ct) return false;
    return allowed.test(ct.trim());
}

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
