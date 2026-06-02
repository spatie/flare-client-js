import { describe, expect, it } from 'vitest';

import { collectProcessAttributes } from '../src/context/process';

describe('collectProcessAttributes', () => {
    it('includes runtime + host attributes', () => {
        const attrs = collectProcessAttributes();
        expect(attrs['process.runtime.name']).toBe('nodejs');
        expect(attrs['process.runtime.version']).toBe(process.version);
        expect(typeof attrs['process.pid']).toBe('number');
        expect(typeof attrs['process.uptime']).toBe('number');
        expect(typeof attrs['host.name']).toBe('string');
        expect(typeof attrs['os.type']).toBe('string');
    });
});
