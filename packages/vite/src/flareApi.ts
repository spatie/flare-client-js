import { deflateRawSync } from 'zlib';

import { Sourcemap } from './index';

export default class FlareApi {
    endpoint: string;
    key: string;
    version: string;

    constructor(endpoint: string, key: string, version: string) {
        this.endpoint = endpoint;
        this.key = key;
        this.version = version;
    }

    uploadSourcemap(sourcemap: Sourcemap): Promise<unknown> {
        const base64GzipSourcemap = deflateRawSync(sourcemap.content).toString('base64');

        return this.postWithRetry({
            key: this.key,
            version_id: this.version,
            relative_filename: sourcemap.original_file,
            sourcemap: base64GzipSourcemap,
        });
    }

    private async postWithRetry(data: Record<string, string>, retries = 3): Promise<unknown> {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const response = await fetch(this.endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data),
                });

                if (!response.ok) {
                    const body = await response.text();
                    throw `${response.status}: ${body}`;
                }

                return await response.json();
            } catch (error: unknown) {
                if (typeof error === 'string') {
                    throw error;
                }

                // Network error (DNS, socket, etc.) - retry if attempts remain
                if (attempt < retries) {
                    await this.delay(attempt * 1000);
                    continue;
                }

                throw `Network error: ${error instanceof Error ? error.message : String(error)}`;
            }
        }

        throw 'Unexpected: retry loop exited without returning or throwing';
    }

    private delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
