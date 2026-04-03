import { describe, expect, test } from 'vitest';
import type { ComponentPublicInstance } from 'vue';

import { buildComponentHierarchyFrames } from '../src/buildComponentHierarchyFrames';
import { MAX_HIERARCHY_DEPTH } from '../src/constants';

function createMockInstance(
    name: string,
    {
        parent = null,
        file = undefined,
        props = undefined,
    }: {
        parent?: ComponentPublicInstance | null;
        file?: string;
        props?: Record<string, unknown>;
    } = {}
): ComponentPublicInstance {
    return {
        $options: {
            __name: name,
            ...(file !== undefined ? { __file: file } : {}),
        },
        $parent: parent,
        $props: props ?? {},
    } as unknown as ComponentPublicInstance;
}

describe('buildComponentHierarchyFrames', () => {
    test('returns an empty array for null instance', () => {
        expect(buildComponentHierarchyFrames(null)).toEqual([]);
    });

    test('returns a single frame for a root component', () => {
        const instance = createMockInstance('App');

        expect(buildComponentHierarchyFrames(instance)).toEqual([{ component: 'App', file: null, props: {} }]);
    });

    test('builds frames through $parent chain', () => {
        const grandparent = createMockInstance('App');
        const parent = createMockInstance('Layout', { parent: grandparent });
        const child = createMockInstance('Button', { parent });

        const frames = buildComponentHierarchyFrames(child);

        expect(frames).toEqual([
            { component: 'Button', file: null, props: {} },
            { component: 'Layout', file: null, props: {} },
            { component: 'App', file: null, props: {} },
        ]);
    });

    test('includes __file when available', () => {
        const parent = createMockInstance('App', { file: 'src/App.vue' });
        const child = createMockInstance('Button', {
            parent,
            file: 'src/components/Button.vue',
        });

        const frames = buildComponentHierarchyFrames(child);

        expect(frames[0].file).toBe('src/components/Button.vue');
        expect(frames[1].file).toBe('src/App.vue');
    });

    test('sets file to null when __file is not present', () => {
        const instance = createMockInstance('App');

        const frames = buildComponentHierarchyFrames(instance);

        expect(frames[0].file).toBeNull();
    });

    test('includes props from the component instance', () => {
        const parent = createMockInstance('App');
        const child = createMockInstance('UserCard', {
            parent,
            props: { userId: 42, name: 'Alice' },
        });

        const frames = buildComponentHierarchyFrames(child);

        expect(frames[0].props).toEqual({ userId: 42, name: 'Alice' });
        expect(frames[1].props).toEqual({});
    });

    test('creates a shallow copy of props', () => {
        const originalProps = { userId: 42 };
        const instance = createMockInstance('UserCard', { props: originalProps });

        const frames = buildComponentHierarchyFrames(instance);

        expect(frames[0].props).toEqual({ userId: 42 });
        expect(frames[0].props).not.toBe(originalProps);
    });

    test('sets props to null when $props is null', () => {
        const instance = {
            $options: { __name: 'App' },
            $parent: null,
            $props: null,
        } as unknown as ComponentPublicInstance;

        const frames = buildComponentHierarchyFrames(instance);

        expect(frames[0].props).toBeNull();
    });

    test('uses AnonymousComponent for unnamed components in the chain', () => {
        const parent = createMockInstance('App');
        const child = {
            $options: {},
            $parent: parent,
            $props: {},
        } as unknown as ComponentPublicInstance;

        const frames = buildComponentHierarchyFrames(child);

        expect(frames[0].component).toBe('AnonymousComponent');
        expect(frames[1].component).toBe('App');
    });

    test('respects MAX_HIERARCHY_DEPTH limit', () => {
        let current: ComponentPublicInstance | null = null;

        for (let i = 0; i < MAX_HIERARCHY_DEPTH + 50; i++) {
            current = createMockInstance(`Component${i}`, { parent: current });
        }

        const frames = buildComponentHierarchyFrames(current);

        expect(frames).toHaveLength(MAX_HIERARCHY_DEPTH);
        expect(frames[0].component).toBe(`Component${MAX_HIERARCHY_DEPTH + 49}`);
        expect(frames[MAX_HIERARCHY_DEPTH - 1].component).toBe('Component50');
    });

    test('combines file, props, and hierarchy correctly', () => {
        const root = createMockInstance('App', { file: 'src/App.vue' });
        const layout = createMockInstance('Layout', {
            parent: root,
            file: 'src/layouts/Layout.vue',
            props: { sidebar: true },
        });
        const page = createMockInstance('UserProfile', {
            parent: layout,
            file: 'src/pages/UserProfile.vue',
            props: { userId: 42, tab: 'settings' },
        });

        const frames = buildComponentHierarchyFrames(page);

        expect(frames).toEqual([
            {
                component: 'UserProfile',
                file: 'src/pages/UserProfile.vue',
                props: { userId: 42, tab: 'settings' },
            },
            {
                component: 'Layout',
                file: 'src/layouts/Layout.vue',
                props: { sidebar: true },
            },
            {
                component: 'App',
                file: 'src/App.vue',
                props: {},
            },
        ]);
    });
});
