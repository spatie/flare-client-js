import type { FileReader } from '@flareapp/core';

/**
 * Fetches source files so the stack-trace builder can render a snippet around the offending line.
 * Only http(s) is fetched: other schemes (chrome-extension://, file://, blob:, data:) would cross a
 * privilege boundary or hit a CORS/CSP wall for nothing. Returns null on any failure, never throws.
 */
export class FetchFileReader implements FileReader {
    read(url: string): Promise<string | null> {
        if (!/^https?:\/\//i.test(url)) {
            return Promise.resolve(null);
        }
        return fetch(url)
            .then((response) => {
                if (response.status !== 200) {
                    return null;
                }
                return response.text();
            })
            .catch(() => null);
    }
}
