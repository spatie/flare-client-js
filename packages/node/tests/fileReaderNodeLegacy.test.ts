import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/stacktrace/nativeImport', () => ({
    nativeImport: (specifier: string) => import(specifier),
}));

import { DiskFileReader } from '../src/stacktrace/DiskFileReader';

describe('DiskFileReader integration', () => {
    it('still reads disk files (legacy regression check)', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'flare-legacy-'));
        const file = join(dir, 'x.js');
        writeFileSync(file, 'A\nB\nC');
        const reader = new DiskFileReader();
        expect(await reader.read(file)).toBe('A\nB\nC');
    });
});
