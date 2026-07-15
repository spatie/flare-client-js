import { describe, expect, test } from 'vitest';

import { getComponentName } from '../src/getComponentName';
import { createMockInstance } from './helpers';

describe('getComponentName', () => {
    test('returns __name when available', () => {
        const instance = createMockInstance('MyComponent');

        expect(getComponentName(instance)).toBe('MyComponent');
    });

    test('falls back to name when __name is not available', () => {
        const instance = createMockInstance(undefined, { name: 'FallbackName' });

        expect(getComponentName(instance)).toBe('FallbackName');
    });

    test('prefers __name over name', () => {
        const instance = createMockInstance('Preferred', { name: 'Fallback' });

        expect(getComponentName(instance)).toBe('Preferred');
    });

    test('returns AnonymousComponent when instance is null', () => {
        expect(getComponentName(null)).toBe('AnonymousComponent');
    });

    test('returns AnonymousComponent when no name is set', () => {
        const instance = createMockInstance();

        expect(getComponentName(instance)).toBe('AnonymousComponent');
    });

    test('returns AnonymousComponent when __name is empty string', () => {
        const instance = createMockInstance('');

        expect(getComponentName(instance)).toBe('AnonymousComponent');
    });

    test('returns name when __name is empty string but name is set', () => {
        const instance = createMockInstance('', { name: 'ValidName' });

        expect(getComponentName(instance)).toBe('ValidName');
    });
});
