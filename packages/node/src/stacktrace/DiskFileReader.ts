import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import type { FileReader } from '@flareapp/core';

/**
 * Node `FileReader` that reads source files from disk for stack-trace snippets. On the server a frame's
 * "URL" is usually a local path (`/app/dist/server.js`) or a `file://` URL (from `import.meta.url`), so
 * resolve off disk instead of over the network.
 *
 * Safety gates:
 * 1. Local-path allowlist: only `file://` URLs and absolute paths (POSIX, Windows drive, UNC) are read;
 *    HTTP URLs and relative paths return `null`. Refusing anything that isn't unambiguously a local file
 *    avoids traversal, following http frames in a server build, and cwd-relative ambiguity.
 * 2. Catch-all: any failure (missing file, permissions, etc) returns `null`. `read()` never throws.
 */
export class DiskFileReader implements FileReader {
    async read(url: string): Promise<string | null> {
        if (!isLocalFileUrl(url)) return null;
        try {
            const path = /^file:\/\//i.test(url) ? fileURLToPath(url) : url;
            return await readFile(path, 'utf-8');
        } catch {
            return null;
        }
    }
}

/**
 * True for shapes we treat as a local file: `file://` URLs (any scheme casing), POSIX absolute paths,
 * Windows drive-letter paths (`C:\foo`, `c:/foo`), and Windows UNC (`\\`). Everything else is rejected.
 */
function isLocalFileUrl(url: string): boolean {
    return /^file:\/\//i.test(url) || url.startsWith('/') || /^[a-z]:[\\/]/i.test(url) || url.startsWith('\\\\');
}
