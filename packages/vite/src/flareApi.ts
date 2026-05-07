import { deflateRawSync } from 'node:zlib';

import { Sourcemap } from './types';

const RETRIABLE_STATUS_CODES = new Set([429, 502, 503, 504]);

export class FlareApi {
    constructor(
        private readonly endpoint: string,
        private readonly key: string,
        private readonly version: string
    ) {}

    uploadSourcemap(sourcemap: Sourcemap): Promise<void> {
        const base64GzipSourcemap = deflateRawSync(sourcemap.content).toString('base64');

        return this.postWithRetry({
            key: this.key,
            version_id: this.version,
            relative_filename: sourcemap.originalFile,
            sourcemap: base64GzipSourcemap,
        });
    }

    private async postWithRetry(data: Record<string, string>, maxRetries = 3): Promise<void> {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const response = await fetch(this.endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data),
                });

                if (response.ok) {
                    return;
                }

                if (!RETRIABLE_STATUS_CODES.has(response.status)) {
                    const body = await response.text();
                    throw new Error(`Flare API returned ${response.status}: ${body}`);
                }

                if (attempt === maxRetries) {
                    throw new Error(`Flare API returned ${response.status} after ${maxRetries} attempts`);
                }
            } catch (error: unknown) {
                if (error instanceof Error && error.message.startsWith('Flare API returned')) {
                    throw error;
                }

                if (attempt === maxRetries) {
                    const message = error instanceof Error ? error.message : String(error);
                    throw new Error(`Network error after ${maxRetries} attempts: ${message}`);
                }
            }

            await this.delay(Math.pow(2, attempt - 1) * 1000);
        }
    }

    private delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
