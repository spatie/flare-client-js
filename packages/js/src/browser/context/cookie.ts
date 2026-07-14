import type { Attributes } from '@flareapp/core';

/**
 * Parses `document.cookie` into `http.request.cookies`, redacting the value of any cookie whose name
 * matches `denylist`. Null-prototype accumulator so a cookie named `__proto__` is stored, not dropped.
 */
export default function cookie(denylist: RegExp): Attributes {
    if (!window.document.cookie) {
        return {};
    }

    const cookies: Record<string, string> = Object.create(null);

    window.document.cookie.split('; ').forEach((rawCookie) => {
        const idx = rawCookie.indexOf('=');
        if (idx === -1) {
            cookies[rawCookie] = denylist.test(rawCookie) ? '[redacted]' : '';
            return;
        }
        const name = rawCookie.slice(0, idx);
        const value = rawCookie.slice(idx + 1);
        cookies[name] = denylist.test(name) ? '[redacted]' : value;
    });

    return {
        'http.request.cookies': cookies,
    };
}
