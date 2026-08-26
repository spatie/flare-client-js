import { describe, expect, it } from 'vitest';

import { collectProcessAttributes } from '../src/context/process';

describe('collectProcessAttributes', () => {
    it('includes host + process attributes', () => {
        const attrs = collectProcessAttributes();
        expect(typeof attrs['process.pid']).toBe('number');
        expect(typeof attrs['process.uptime']).toBe('number');
        expect(typeof attrs['host.name']).toBe('string');
        expect(typeof attrs['host.arch']).toBe('string');
    });

    it('leaves os and runtime to NodeDeviceInfoProvider', () => {
        const attrs = collectProcessAttributes();
        expect(attrs['os.type']).toBeUndefined();
        expect(attrs['process.runtime.name']).toBeUndefined();
    });
});
