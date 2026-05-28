import { describe, expect, it } from 'vitest';

import { NodeScope } from '../src';

describe('public exports from @flareapp/node', () => {
    it('exports NodeScope as a class', () => {
        expect(typeof NodeScope).toBe('function');
        const s = new NodeScope();
        expect(s).toBeDefined();
    });
});
