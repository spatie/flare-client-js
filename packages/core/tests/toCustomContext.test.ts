import { describe, expect, it } from 'vitest';

import { toCustomContext } from '../src/util/toCustomContext';

describe('toCustomContext', () => {
    it('wraps a payload under context.custom keyed by framework', () => {
        expect(toCustomContext('svelte', { a: 1 })).toEqual({ 'context.custom': { svelte: { a: 1 } } });
    });
});
