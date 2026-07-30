import { describe, expect, it } from 'vitest';

import { withoutStatefulFlags } from '../src/util/statelessRegExp';

describe('withoutStatefulFlags', () => {
    it('drops g and y so repeated test() calls agree', () => {
        const pattern = withoutStatefulFlags(/node_modules/g);

        expect(pattern.test('/app/node_modules/a/A.svelte')).toBe(true);
        expect(pattern.test('/app/node_modules/b/B.svelte')).toBe(true);
    });

    it('returns a stateless pattern unchanged, and undefined for undefined', () => {
        const pattern = /routes/i;

        expect(withoutStatefulFlags(pattern)).toBe(pattern);
        expect(withoutStatefulFlags(undefined)).toBeUndefined();
    });
});
