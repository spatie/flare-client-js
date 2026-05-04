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
        expect(buildComponentHierarchyFrames(null, { attachProps: true, propsMaxDepth: 2 })).toEqual([]);
    });

    test('returns a single frame for a root component', () => {
        const instance = createMockInstance('App');

        expect(buildComponentHierarchyFrames(instance, { attachProps: true, propsMaxDepth: 2 })).toEqual([
            { component: 'App', file: null, props: {} },
        ]);
    });

    test('builds frames through $parent chain', () => {
        const grandparent = createMockInstance('App');
        const parent = createMockInstance('Layout', { parent: grandparent });
        const child = createMockInstance('Button', { parent });

        const frames = buildComponentHierarchyFrames(child, { attachProps: true, propsMaxDepth: 2 });

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

        const frames = buildComponentHierarchyFrames(child, { attachProps: true, propsMaxDepth: 2 });

        expect(frames[0].file).toBe('src/components/Button.vue');
        expect(frames[1].file).toBe('src/App.vue');
    });

    test('sets file to null when __file is not present', () => {
        const instance = createMockInstance('App');

        const frames = buildComponentHierarchyFrames(instance, { attachProps: true, propsMaxDepth: 2 });

        expect(frames[0].file).toBeNull();
    });

    test('includes props from the component instance', () => {
        const parent = createMockInstance('App');
        const child = createMockInstance('UserCard', {
            parent,
            props: { userId: 42, name: 'Alice' },
        });

        const frames = buildComponentHierarchyFrames(child, { attachProps: true, propsMaxDepth: 2 });

        expect(frames[0].props).toEqual({ userId: 42, name: 'Alice' });
        expect(frames[1].props).toEqual({});
    });

    test('creates a shallow copy of props', () => {
        const originalProps = { userId: 42 };
        const instance = createMockInstance('UserCard', { props: originalProps });

        const frames = buildComponentHierarchyFrames(instance, { attachProps: true, propsMaxDepth: 2 });

        expect(frames[0].props).toEqual({ userId: 42 });
        expect(frames[0].props).not.toBe(originalProps);
    });

    test('omits props when $props is null and attachProps is true', () => {
        const instance = {
            $options: { __name: 'App' },
            $parent: null,
            $props: null,
        } as unknown as ComponentPublicInstance;

        const frames = buildComponentHierarchyFrames(instance, { attachProps: true, propsMaxDepth: 2 });

        expect('props' in frames[0]).toBe(false);
    });

    test('uses AnonymousComponent for unnamed components in the chain', () => {
        const parent = createMockInstance('App');
        const child = {
            $options: {},
            $parent: parent,
            $props: {},
        } as unknown as ComponentPublicInstance;

        const frames = buildComponentHierarchyFrames(child, { attachProps: true, propsMaxDepth: 2 });

        expect(frames[0].component).toBe('AnonymousComponent');
        expect(frames[1].component).toBe('App');
    });

    test('respects MAX_HIERARCHY_DEPTH limit', () => {
        let current: ComponentPublicInstance | null = null;

        for (let i = 0; i < MAX_HIERARCHY_DEPTH + 50; i++) {
            current = createMockInstance(`Component${i}`, { parent: current });
        }

        const frames = buildComponentHierarchyFrames(current, { attachProps: true, propsMaxDepth: 2 });

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

        const frames = buildComponentHierarchyFrames(page, { attachProps: true, propsMaxDepth: 2 });

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

    describe('attachProps', () => {
        test('omits props on every frame when attachProps is false', () => {
            const parent = createMockInstance('Parent', { props: { parentProp: 1 } });
            const child = createMockInstance('Child', { parent, props: { childProp: 2 } });

            const frames = buildComponentHierarchyFrames(child, { attachProps: false, propsMaxDepth: 2 });

            expect(frames).toEqual([
                { component: 'Child', file: null },
                { component: 'Parent', file: null },
            ]);
            frames.forEach((frame) => expect('props' in frame).toBe(false));
        });

        test('includes serialized props on each frame when attachProps is true', () => {
            const parent = createMockInstance('Parent', { props: { flag: true } });
            const child = createMockInstance('Child', { parent, props: { count: 3 } });

            const frames = buildComponentHierarchyFrames(child, { attachProps: true, propsMaxDepth: 2 });

            expect(frames).toEqual([
                { component: 'Child', file: null, props: { count: 3 } },
                { component: 'Parent', file: null, props: { flag: true } },
            ]);
        });

        test('forwards propsMaxDepth to serializer', () => {
            const instance = createMockInstance('X', { props: { deep: { a: { b: 1 } } } });

            const frames = buildComponentHierarchyFrames(instance, { attachProps: true, propsMaxDepth: 1 });

            expect(frames[0].props).toEqual({ deep: { a: '[Object]' } });
        });

        test('replaces functions in props with "[Function]" sentinel', () => {
            const instance = createMockInstance('X', { props: { onClick: () => 0 } });

            const frames = buildComponentHierarchyFrames(instance, { attachProps: true, propsMaxDepth: 2 });

            expect(frames[0].props).toEqual({ onClick: '[Function]' });
        });

        test('redacts denylisted keys using the default denylist', () => {
            const instance = createMockInstance('X', { props: { token: 'secret', id: 1 } });

            const frames = buildComponentHierarchyFrames(instance, { attachProps: true, propsMaxDepth: 2 });

            expect(frames[0].props).toEqual({ token: '[redacted]', id: 1 });
        });

        test('forwards a custom denylist to the serializer', () => {
            const instance = createMockInstance('X', { props: { foo: 'x', bar: 'y' } });

            const frames = buildComponentHierarchyFrames(instance, {
                attachProps: true,
                propsMaxDepth: 2,
                propsDenylist: /^foo$/,
            });

            expect(frames[0].props).toEqual({ foo: '[redacted]', bar: 'y' });
        });
    });
});
