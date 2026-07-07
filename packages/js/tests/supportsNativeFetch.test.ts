import { describe, expect, it } from 'vitest';

import { isNativeFetch } from '../src/tracing/supportsNativeFetch';

describe('isNativeFetch', () => {
    it('is true for a genuinely native builtin', () => {
        expect(isNativeFetch(Math.max)).toBe(true);
    });

    it('is false for a plain JS wrapper', () => {
        const wrapper = (x: number) => x;
        expect(isNativeFetch(wrapper)).toBe(false);
    });

    it('is not fooled by a wrapper that overrides its own toString', () => {
        const spoof = (x: number) => x;
        spoof.toString = () => 'function fetch() { [native code] }';
        expect(isNativeFetch(spoof)).toBe(false); // prototype toString ignores the override
    });

    it('is false for non-functions', () => {
        expect(isNativeFetch(undefined)).toBe(false);
        expect(isNativeFetch(42)).toBe(false);
    });
});
