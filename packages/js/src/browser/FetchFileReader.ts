import type { FileReader } from '@flareapp/core';

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
