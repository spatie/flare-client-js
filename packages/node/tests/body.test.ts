import { Readable } from 'node:stream';

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
        expect(Buffer.byteLength(out!, 'utf8')).toBeLessThanOrEqual(100);
        expect(out!.endsWith('…[truncated]')).toBe(true);
    });

    it('truncates by UTF-8 byte length, not character length, for multi-byte payloads', () => {
        // Three-byte char (CJK) repeated. 200 chars = 600 UTF-8 bytes.
        const big = { v: '漢'.repeat(200) };
        const out = captureBody(big, undefined, { ...opts, bodyMaxBytes: 100 });
        expect(out).not.toBeNull();
        expect(Buffer.byteLength(out!, 'utf8')).toBeLessThanOrEqual(100);
        expect(out!.endsWith('…[truncated]')).toBe(true);
    });

    it('never leaves a partial multi-byte sequence at the cut', () => {
        const big = { v: '漢'.repeat(200) };
        const out = captureBody(big, undefined, { ...opts, bodyMaxBytes: 50 });
        // Decoded buffer must round-trip cleanly (no Unicode replacement char).
        expect(out!.includes('�')).toBe(false);
    });

    it('emits only suffix when budget is too small', () => {
        const big = { v: 'x'.repeat(100) };
        const out = captureBody(big, undefined, { ...opts, bodyMaxBytes: 5 });
        // 5 bytes can't fit 14-byte suffix + any payload. Result should be the
        // suffix truncated to 5 bytes, staying within the byte budget.
        expect(Buffer.byteLength(out!, 'utf8')).toBeLessThanOrEqual(5);
    });

    it('ASCII-only path still truncates at byte budget including suffix', () => {
        const big = { v: 'x'.repeat(200) };
        const out = captureBody(big, undefined, { ...opts, bodyMaxBytes: 50 });
        expect(Buffer.byteLength(out!, 'utf8')).toBeLessThanOrEqual(50);
        expect(out!.endsWith('…[truncated]')).toBe(true);
    });

    it('handles circular references', () => {
        const obj: any = { a: 1 };
        obj.self = obj;
        const out = captureBody(obj, undefined, opts);
        expect(out).toContain('"[Circular]"');
    });

    it('skips Node streams', () => {
        const stream = Readable.from(['x']);
        expect(captureBody(stream, undefined, opts)).toBeNull();
    });

    it('skips ArrayBuffer and typed arrays', () => {
        expect(captureBody(new ArrayBuffer(8), undefined, opts)).toBeNull();
        expect(captureBody(new Uint8Array([1, 2, 3]), undefined, opts)).toBeNull();
    });

    it('skips FormData', () => {
        const fd = new FormData();
        fd.append('a', '1');
        expect(captureBody(fd, undefined, opts)).toBeNull();
    });

    it('skips class instances with non-Object prototypes', () => {
        class User {
            constructor(public id: string) {}
        }
        expect(captureBody(new User('u1'), undefined, opts)).toBeNull();
    });

    it('still accepts plain objects and arrays', () => {
        expect(captureBody({ a: 1 }, undefined, opts)).toBe('{"a":1}');
        expect(captureBody([1, 2, 3], undefined, opts)).toBe('[1,2,3]');
        expect(captureBody(Object.create(null), undefined, opts)).toBe('{}');
    });
});
