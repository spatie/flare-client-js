import { describe, expect, it } from 'vitest';

import { flare } from '../src';

describe('Node flare.flush', () => {
    it('resolves quickly when there is nothing in flight', async () => {
        const start = Date.now();
        await flare.flush(1000);
        expect(Date.now() - start).toBeLessThan(50);
    });
});
