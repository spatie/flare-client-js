import type { FileReader } from '@flareapp/core';

import { nativeImport } from './nativeImport';

/**
 * Node `FileReader` implementation that reads source files from disk.
 *
 * Wired into `@flareapp/node`'s singleton so the stack-trace builder can pull
 * source for each frame and render a snippet. On the server the frame's "URL"
 * is usually a local path (e.g. `/app/dist/server.js`) or a `file://` URL
 * (from `import.meta.url`), so we resolve straight off disk instead of going
 * over the network.
 *
 * Safety gates:
 *
 * 1. **Local-path allowlist.** Only `file://` URLs and absolute filesystem
 *    paths (POSIX `/foo`, Windows `C:\foo` or `\\server\share\foo`) are
 *    accepted. HTTP URLs and relative paths return `null` immediately. We
 *    refuse to read anything that does not unambiguously identify a local
 *    file — no surprise traversal, no following http stack frames in a
 *    server build, no relative-path ambiguity around the current working
 *    directory.
 * 2. **Lazy native imports.** `node:url` and `node:fs/promises` are loaded
 *    via `nativeImport` (a `new Function('id', 'return import(id)')`
 *    indirection) so bundlers that statically analyze `import()` calls do
 *    not trip over `node:` specifiers when this file is accidentally
 *    bundled into a non-Node target. See `nativeImport.ts` for the why.
 * 3. **Catch-all.** Missing files, permission errors, and any other failure
 *    return `null`. The `read()` contract returns `null` on every failure
 *    path and never throws.
 *
 * `fileURLToPath` is used when the input is a `file://` URL so we hand
 * `readFile` a real OS path. Otherwise the URL IS already a path and is
 * passed through unchanged.
 */
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

/**
 * Return true when `url` is something we are willing to treat as a local
 * file. Matches four shapes:
 *
 * - `file://...` URLs (any casing of the scheme)
 * - POSIX absolute paths starting with `/`
 * - Windows drive-letter paths like `C:\foo` or `c:/foo`
 * - Windows UNC paths starting with `\\`
 *
 * Anything else (relative paths, http, data, blob, etc) is rejected.
 */
function isLocalFileUrl(url: string): boolean {
    return /^file:\/\//i.test(url) || url.startsWith('/') || /^[a-z]:[\\/]/i.test(url) || url.startsWith('\\\\');
}
