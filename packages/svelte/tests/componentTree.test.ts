import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, test } from 'vitest';

import { findNode, lookupComponentTree } from '../src/componentTree';
import Child from './fixtures/Child.svelte';
import ConditionalChild from './fixtures/ConditionalChild.svelte';
import MultiInstanceChild from './fixtures/MultiInstanceChild.svelte';
import ParentWithChild from './fixtures/ParentWithChild.svelte';

afterEach(() => {
    cleanup();
});

describe('componentTree', () => {
    test('registers component and allows lookup', () => {
        render(Child);

        expect(lookupComponentTree('src/Child.svelte')).toEqual(['Child']);
    });

    test('builds parent-child hierarchy via context', () => {
        render(ParentWithChild);

        expect(lookupComponentTree('src/Child.svelte')).toEqual(['Child', 'Parent']);
    });

    test('cleans up registry entry when component is destroyed', () => {
        const { rerender } = render(ConditionalChild, { props: { show: true } });

        expect(lookupComponentTree('src/Child.svelte')).toEqual(['Child']);

        rerender({ show: false });

        expect(lookupComponentTree('src/Child.svelte')).toEqual([]);
    });

    test('cleans up all instances when all are destroyed', () => {
        const first = render(Child);
        const second = render(Child);

        expect(lookupComponentTree('src/Child.svelte').length).toBeGreaterThan(0);

        first.unmount();
        expect(lookupComponentTree('src/Child.svelte').length).toBeGreaterThan(0);

        second.unmount();
        expect(lookupComponentTree('src/Child.svelte')).toEqual([]);
    });
});

describe('componentTree multi-instance disambiguation', () => {
    test('tracks multiple instances of same component with different parents', () => {
        render(MultiInstanceChild);

        const parentANode = findNode('src/ParentA.svelte');
        const parentBNode = findNode('src/ParentB.svelte');
        expect(parentANode).toBeDefined();
        expect(parentBNode).toBeDefined();

        const underA = lookupComponentTree('src/Child.svelte', parentANode);
        expect(underA).toEqual(['Child', 'ParentA']);

        const underB = lookupComponentTree('src/Child.svelte', parentBNode);
        expect(underB).toEqual(['Child', 'ParentB']);
    });

    test('falls back to first match when no ancestor provided', () => {
        render(MultiInstanceChild);

        const hierarchy = lookupComponentTree('src/Child.svelte');
        expect(hierarchy[0]).toBe('Child');
        expect(['ParentA', 'ParentB']).toContain(hierarchy[1]);
    });

    test('falls back to first match when ancestor does not match any instance', () => {
        render(MultiInstanceChild);

        const fakeAncestor = { name: 'Fake', file: 'src/Fake.svelte', parent: null };
        const hierarchy = lookupComponentTree('src/Child.svelte', fakeAncestor);

        expect(hierarchy[0]).toBe('Child');
        expect(['ParentA', 'ParentB']).toContain(hierarchy[1]);
    });

    test('returns correct hierarchy after one instance is destroyed', () => {
        const { unmount: unmountMulti } = render(MultiInstanceChild);

        const parentBNode = findNode('src/ParentB.svelte');
        expect(lookupComponentTree('src/Child.svelte', parentBNode)).toEqual(['Child', 'ParentB']);

        unmountMulti();

        expect(lookupComponentTree('src/Child.svelte')).toEqual([]);
        expect(lookupComponentTree('src/ParentA.svelte')).toEqual([]);
        expect(lookupComponentTree('src/ParentB.svelte')).toEqual([]);
    });
});
