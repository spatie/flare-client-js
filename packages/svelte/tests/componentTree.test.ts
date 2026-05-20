import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, test } from 'vitest';

import { lookupComponentTree } from '../src/componentTree';
import Child from './fixtures/Child.svelte';
import ConditionalChild from './fixtures/ConditionalChild.svelte';
import ParentWithChild from './fixtures/ParentWithChild.svelte';

afterEach(() => {
    cleanup();
});

describe('componentTree', () => {
    test('registers component and allows lookup', () => {
        render(Child);

        const hierarchy = lookupComponentTree('src/Child.svelte');
        expect(hierarchy).toEqual(['Child']);
    });

    test('builds parent-child hierarchy via context', () => {
        render(ParentWithChild);

        const hierarchy = lookupComponentTree('src/Child.svelte');
        expect(hierarchy).toEqual(['Child', 'Parent']);
    });

    test('cleans up registry entry when component is destroyed', () => {
        const { rerender } = render(ConditionalChild, { props: { show: true } });

        expect(lookupComponentTree('src/Child.svelte')).toEqual(['Child']);

        rerender({ show: false });

        expect(lookupComponentTree('src/Child.svelte')).toEqual([]);
    });

    test('does not remove registry entry if a newer instance replaced it', () => {
        const first = render(ConditionalChild, { props: { show: true } });

        const second = render(Child);

        first.rerender({ show: false });

        expect(lookupComponentTree('src/Child.svelte')).toEqual(['Child']);

        second.unmount();

        expect(lookupComponentTree('src/Child.svelte')).toEqual([]);
    });
});
