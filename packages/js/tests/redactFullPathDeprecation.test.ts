import { describe, expect, it } from 'vitest';

import { redactFullPath, redactUrlQuery } from '../src';

describe('redactFullPath deprecated alias', () => {
    it('is the same function as redactUrlQuery', () => {
        expect(redactFullPath).toBe(redactUrlQuery);
    });
});
