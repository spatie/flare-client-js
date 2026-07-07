import type { FileReader } from '@flareapp/core';

/**
 * Browser `FileReader` that fetches source files over HTTP(S) so the stack-trace builder can
 * render a code snippet around the offending line. Source URL comes from the frame (usually the
 * JS bundle URL, post-sourcemap resolution). `read()` returns null on any failure, never throws.
 *
 * Three safety gates:
 * 1. Scheme allowlist: only http(s) is fetched. Other schemes (chrome-extension://, file://,
 *    blob:, data:) return null, avoiding privilege boundaries and noisy CORS/CSP walls.
 * 2. Status check: only 200 OK is used. fetch handles 3xx transparently; 4xx/5xx return null so
 *    the snippet is omitted.
 * 3. Catch-all: network/CORS/abort failures return null; a source-fetch failure never leaks to
 *    the consumer page.
 */
export class FetchFileReader implements FileReader {
    read(url: string): Promise<string | null> {
        if (!/^https?:\/\//i.test(url)) return Promise.resolve(null);
        return fetch(url)
            .then((response) => {
                if (response.status !== 200) return null;
                return response.text();
            })
            .catch(() => null);
    }
}
