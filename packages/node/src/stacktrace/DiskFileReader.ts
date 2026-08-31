import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import type { FileReader } from '@flareapp/core';

// Reads snippet sources off disk (a frame's "URL" is usually a local path or a `file://` URL). Only
// unambiguously local paths are read, ruling out traversal and http frames in a server build. Never throws.
export class DiskFileReader implements FileReader {
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

// `file://` (any casing), POSIX absolute, Windows drive-letter (`C:\foo`), Windows UNC (`\\`).
function isLocalFileUrl(url: string): boolean {
    return /^file:\/\//i.test(url) || url.startsWith('/') || /^[a-z]:[\\/]/i.test(url) || url.startsWith('\\\\');
}
