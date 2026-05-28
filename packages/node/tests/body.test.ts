import { describe, expect, it } from 'vitest';

import { captureBody, DEFAULT_BODY_CONTENT_TYPES, DEFAULT_BODY_KEY_DENYLIST } from '../src/context/body';

const opts = {
    bodyAllowedContentTypes: DEFAULT_BODY_CONTENT_TYPES,
    bodyKeyDenylist: DEFAULT_BODY_KEY_DENYLIST,
    bodyMaxBytes: 16_384,
};

describe('captureBody', () => {
    it('returns null for empty body', () => {
        expect(captureBody(undefined, 'application/json', opts)).toBeNull();
    });

    it('parses JSON body and redacts password key', () => {
        const out = captureBody('{"user":"x","password":"secret"}', 'application/json', opts);
        const parsed = JSON.parse(out!);
        expect(parsed).toEqual({ user: 'x', password: '[redacted]' });
    });

    it('accepts content-type with parameters', () => {
        const out = captureBody('{"a":1}', 'application/json; charset=utf-8', opts);
        expect(out).toBe('{"a":1}');
    });

    it('rejects content-types not in allowlist', () => {
        expect(captureBody('hello', 'text/plain', opts)).toBeNull();
    });

    it('decodes Buffer input as UTF-8', () => {
        const out = captureBody(Buffer.from('{"k":1}'), 'application/json', opts);
        expect(out).toBe('{"k":1}');
    });

    it('skips content-type check when body is already an object', () => {
        const out = captureBody({ a: 1, token: 'x' }, undefined, opts);
        expect(JSON.parse(out!)).toEqual({ a: 1, token: '[redacted]' });
    });

    it('handles URLSearchParams', () => {
        const out = captureBody(new URLSearchParams({ a: '1', secret: 'x' }), undefined, opts);
        expect(JSON.parse(out!)).toEqual({ a: '1', secret: '[redacted]' });
    });

    it('truncates over bodyMaxBytes', () => {
        const big = { v: 'x'.repeat(20_000) };
        const out = captureBody(big, undefined, { ...opts, bodyMaxBytes: 100 });
        expect(out!.length).toBeLessThanOrEqual(120);
        expect(out!.endsWith('…[truncated]')).toBe(true);
    });

    it('handles circular references', () => {
        const obj: any = { a: 1 };
        obj.self = obj;
        const out = captureBody(obj, undefined, opts);
        expect(out).toContain('"[Circular]"');
    });
});
