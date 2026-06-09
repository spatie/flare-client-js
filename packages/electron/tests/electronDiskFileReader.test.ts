import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ElectronDiskFileReader } from '../src/main/ElectronDiskFileReader';

describe('ElectronDiskFileReader', () => {
    it('reads an absolute path', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'flare-electron-'));
        const file = join(dir, 'a.js');
        await writeFile(file, 'console.log(1)', 'utf-8');
        const reader = new ElectronDiskFileReader();
        expect(await reader.read(file)).toBe('console.log(1)');
    });

    it('reads a file:// URL', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'flare-electron-'));
        const file = join(dir, 'b.js');
        await writeFile(file, 'const x = 2', 'utf-8');
        const reader = new ElectronDiskFileReader();
        expect(await reader.read(pathToFileURL(file).href)).toBe('const x = 2');
    });

    it('returns null for http urls and relative paths and missing files', async () => {
        const reader = new ElectronDiskFileReader();
        expect(await reader.read('https://example.com/app.js')).toBeNull();
        expect(await reader.read('relative/path.js')).toBeNull();
        expect(await reader.read('/no/such/file/here.js')).toBeNull();
    });
});
