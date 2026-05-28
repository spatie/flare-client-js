import type { FileReader } from '@flareapp/core';

import { nativeImport } from './nativeImport';

export class DiskFileReader implements FileReader {
    async read(url: string): Promise<string | null> {
        if (!isLocalFileUrl(url)) return null;
        try {
            const { fileURLToPath } = await nativeImport<typeof import('node:url')>('node:url');
            const { readFile } = await nativeImport<typeof import('node:fs/promises')>('node:fs/promises');
            const path = /^file:\/\//i.test(url) ? fileURLToPath(url) : url;
            return await readFile(path, 'utf-8');
        } catch {
            return null;
        }
    }
}

function isLocalFileUrl(url: string): boolean {
    return /^file:\/\//i.test(url) || url.startsWith('/') || /^[a-z]:[\\/]/i.test(url) || url.startsWith('\\\\');
}
