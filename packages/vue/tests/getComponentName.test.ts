import { describe, expect, test } from 'vitest';
import type { ComponentPublicInstance } from 'vue';

import { getComponentName } from '../src/getComponentName';

function createMockInstance(options: { __name?: string; name?: string } = {}): ComponentPublicInstance {
    return { $options: options } as unknown as ComponentPublicInstance;
}

describe('getComponentName', () => {
    test('returns __name when available', () => {
        const instance = createMockInstance({ __name: 'MyComponent' });

        expect(getComponentName(instance)).toBe('MyComponent');
    });

    test('falls back to name when __name is not available', () => {
        const instance = createMockInstance({ name: 'FallbackName' });

        expect(getComponentName(instance)).toBe('FallbackName');
    });

    test('prefers __name over name', () => {
        const instance = createMockInstance({ __name: 'Preferred', name: 'Fallback' });

        expect(getComponentName(instance)).toBe('Preferred');
    });

    test('returns AnonymousComponent when instance is null', () => {
        expect(getComponentName(null)).toBe('AnonymousComponent');
    });

    test('returns AnonymousComponent when no name is set', () => {
        const instance = createMockInstance({});

        expect(getComponentName(instance)).toBe('AnonymousComponent');
    });

    test('returns AnonymousComponent when __name is empty string', () => {
        const instance = createMockInstance({ __name: '' });

        expect(getComponentName(instance)).toBe('AnonymousComponent');
    });

    test('returns name when __name is empty string but name is set', () => {
        const instance = createMockInstance({ __name: '', name: 'ValidName' });

        expect(getComponentName(instance)).toBe('ValidName');
    });
});
