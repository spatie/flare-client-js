import type { FileReader } from '@flareapp/core';

/**
 * Browser `FileReader` implementation that fetches source files over HTTP(S).
 *
 * Wired into `@flareapp/js`'s singleton so the stack-trace builder can pull
 * the original source for each frame and render a code snippet around the
 * offending line. The source URL comes from the frame (usually the URL of
 * the JS bundle that produced the error, post-sourcemap resolution).
 *
 * Three safety gates:
 *
 * 1. **Scheme allowlist.** Only `http:` and `https:` URLs are fetched. Other
 *    schemes (`chrome-extension://`, `file://`, `blob:`, `data:`) return
 *    `null` immediately. This avoids surprise privilege boundaries (e.g.,
 *    pages should not read extension-internal files) and dodges CORS/CSP
 *    walls that would error noisily.
 * 2. **Status check.** Only `200 OK` responses are used. 3xx redirects are
 *    handled transparently by `fetch`; 4xx/5xx fall back to `null` so the
 *    snippet is simply omitted from the report.
 * 3. **Catch-all.** Network failures, CORS errors, and aborted requests
 *    return `null`. We never let a source-fetch failure leak as an error
 *    that the consumer page would see.
 *
 * The `read()` contract returns `null` on any failure path, never throws.
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
