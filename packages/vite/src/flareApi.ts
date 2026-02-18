import axios, { AxiosInstance } from 'axios';
import https from 'https';
import { deflateRawSync } from 'zlib';

import { Sourcemap } from './index';

export default class FlareApi {
    endpoint: string;
    key: string;
    version: string;
    private client: AxiosInstance;

    constructor(endpoint: string, key: string, version: string) {
        this.endpoint = endpoint;
        this.key = key;
        this.version = version;
        this.client = axios.create({
            httpsAgent: new https.Agent({ keepAlive: false }),
        });
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
                return await this.client.post(this.endpoint, data);
            } catch (error: unknown) {
                if (axios.isAxiosError(error)) {
                    if (error.response) {
                        // HTTP error (4xx/5xx) - do not retry
                        throw `${error.response.status}: ${JSON.stringify(error.response.data)}`;
                    }

                    // Network error (no response) - retry if attempts remain
                    if (attempt < retries) {
                        await this.delay(attempt * 1000);
                        continue;
                    }

                    // Exhausted retries for network error
                    throw `Network error: ${error.message}`;
                }

                // Non-axios error - do not retry
                throw `Request setup error: ${error instanceof Error ? error.message : String(error)}`;
            }
        }

        throw 'Unexpected: retry loop exited without returning or throwing';
    }

    private delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
