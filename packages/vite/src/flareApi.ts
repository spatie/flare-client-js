import { deflateRawSync } from 'zlib';
import axios from 'axios';
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

    uploadSourcemap(sourcemap: Sourcemap) {
        return new Promise((resolve, reject) => {
            const base64GzipSourcemap = deflateRawSync(
                sourcemap.content,
            ).toString('base64');

            axios
                .post(this.endpoint, {
                    key: this.key,
                    version_id: this.version,
                    relative_filename: sourcemap.original_file,
                    sourcemap: base64GzipSourcemap,
                })
                .then(resolve)
                .catch((error) => {
                    return reject(
                        `${error.response.status}: ${JSON.stringify(error.response.data)}`,
                    );
                });
        });
    }
}
