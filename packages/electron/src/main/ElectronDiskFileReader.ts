import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import type { FileReader } from '@flareapp/core';

/** Reads source snippets for main-process stack frames from disk. Mirrors @flareapp/node's DiskFileReader. */
export class ElectronDiskFileReader implements FileReader {
    async read(url: string): Promise<string | null> {
        if (!isLocalFileUrl(url)) {
            return null;
        }
        try {
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
