import { describe, expect, test } from 'vitest';
import type { ComponentPublicInstance } from 'vue';

import { buildComponentHierarchy } from '../src/buildComponentHierarchy';
import { MAX_HIERARCHY_DEPTH } from '../src/constants';

function createMockInstance(name: string, parent: ComponentPublicInstance | null = null): ComponentPublicInstance {
    return {
        $options: { __name: name },
        $parent: parent,
    } as unknown as ComponentPublicInstance;
}

describe('buildComponentHierarchy', () => {
    test('returns an empty array for null instance', () => {
        expect(buildComponentHierarchy(null)).toEqual([]);
    });

    test('returns a single-element array for a root component', () => {
        const instance = createMockInstance('App');

        expect(buildComponentHierarchy(instance)).toEqual(['App']);
    });

    test('builds hierarchy through $parent chain', () => {
        const grandparent = createMockInstance('App');
        const parent = createMockInstance('Layout', grandparent);
        const child = createMockInstance('Button', parent);

        expect(buildComponentHierarchy(child)).toEqual(['Button', 'Layout', 'App']);
    });

    test('uses AnonymousComponent for unnamed components in the chain', () => {
        const parent = createMockInstance('App');
        const child = {
            $options: {},
            $parent: parent,
        } as unknown as ComponentPublicInstance;

        expect(buildComponentHierarchy(child)).toEqual(['AnonymousComponent', 'App']);
    });

    test('respects MAX_HIERARCHY_DEPTH limit', () => {
        let current: ComponentPublicInstance | null = null;

        for (let i = 0; i < MAX_HIERARCHY_DEPTH + 50; i++) {
            current = createMockInstance(`Component${i}`, current);
        }

        const hierarchy = buildComponentHierarchy(current);

        expect(hierarchy).toHaveLength(MAX_HIERARCHY_DEPTH);
        expect(hierarchy[0]).toBe(`Component${MAX_HIERARCHY_DEPTH + 49}`);
        expect(hierarchy[MAX_HIERARCHY_DEPTH - 1]).toBe('Component50');
    });
});
