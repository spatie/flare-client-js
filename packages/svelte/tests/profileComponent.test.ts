import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const seam = vi.hoisted(async () => (await import('@flareapp/test-helpers')).createComponentSeam());
vi.mock('@flareapp/js/browser', async (importOriginal) =>
    (await import('@flareapp/test-helpers')).componentProfilerMock(await seam, await importOriginal()),
);

import AwaitNested from './fixtures/profile/AwaitNested.svelte';
import Branch from './fixtures/profile/Branch.svelte';
import DeepNested from './fixtures/profile/DeepNested.svelte';
import Leaf from './fixtures/profile/Leaf.svelte';
import Nested from './fixtures/profile/Nested.svelte';

const fake = await seam;

beforeEach(() => {
    fake.reset();
});

describe('__flareProfileComponent', () => {
    it('records one span parented to the active root', async () => {
        render(Leaf, { props: { name: 'ProductGallery' } });
        await tick();

        expect(fake.spans()).toHaveLength(1);
        expect(fake.spans()[0]).toMatchObject({
            name: 'ProductGallery',
            parent: { traceId: 'T', parentSpanId: 'root' },
        });
    });

    it('reads the clock twice, so the span has a real duration', async () => {
        fake.advanceClock();

        render(Leaf, { props: { name: 'ProductGallery' } });
        await tick();

        const span = fake.spans()[0]!;
        expect(span.endTimeUnixNano).toBeGreaterThan(span.startTimeUnixNano);
    });

    // This is also the SSR contract. On the server `activeTracingFlare()` is null module state, so
    // `activeComponentRoot()` returns null and this path is what runs: no span id reserved, no context
    // published, and `onMount` would never fire there anyway. There is no separate svelte/server test
    // because @testing-library/svelte compiles components for the client (it puts the `browser`
    // condition first), and server-rendering a client-compiled component throws `effect_orphan`.
    it('records nothing when no root is active, and still renders', async () => {
        fake.setRoot(null);

        const { container } = render(Leaf, { props: { name: 'ProductGallery' } });
        await tick();

        expect(fake.spans()).toHaveLength(0);
        expect(fake.reserveSpanId).not.toHaveBeenCalled();
        expect(container.textContent).toContain('ProductGallery');
    });

    it('never throws into the host when the seam throws', async () => {
        fake.activeComponentRoot.mockImplementation(() => {
            throw new Error('seam exploded');
        });

        expect(() => render(Leaf, { props: { name: 'ProductGallery' } })).not.toThrow();
    });
});

describe('nesting', () => {
    it('records a childless profiled component on its own', async () => {
        render(Branch, { props: { name: 'Layout' } });
        await tick();

        expect(fake.spans().map((s) => s.name)).toEqual(['Layout']);
    });

    it('records the child before the parent, and points the child at the parent span id', async () => {
        render(Nested);
        await tick();

        const [child, parent] = fake.spans();
        // onMount is bottom-up: the child records first.
        expect(child!.name).toBe('ProductPage');
        expect(parent!.name).toBe('Layout');
        expect(child!.parent).toEqual({ traceId: 'T', parentSpanId: parent!.spanId });
        expect(parent!.parent).toEqual({ traceId: 'T', parentSpanId: 'root' });
    });

    it('re-homes to the live root when an ancestor context belongs to a dead trace', async () => {
        // The layout mounts under the pageload trace...
        render(Branch, { props: { name: 'Layout' } });
        await tick();
        fake.reset();

        // ...then a navigation opens a new root, and only the page re-mounts.
        fake.setRoot({ traceId: 'T2', parentSpanId: 'nav-root' });
        render(Leaf, { props: { name: 'ProductPage' } });
        await tick();

        expect(fake.spans()[0]!.parent).toEqual({ traceId: 'T2', parentSpanId: 'nav-root' });
    });

    // The README promises this: the tree reflects the allowlist, not the real component tree. Only
    // matched files get the call injected at all, so an unmatched component is simply absent from the
    // chain and its context passes straight through.
    it('nests under the nearest MATCHED ancestor, skipping unprofiled components in between', async () => {
        render(DeepNested);
        await tick();

        const layout = fake.spans().find((s) => s.name === 'Layout')!;
        const page = fake.spans().find((s) => s.name === 'ProductPage')!;

        expect(fake.spans()).toHaveLength(2);
        expect(page.parent).toEqual({ traceId: 'T', parentSpanId: layout.spanId });
    });

    // Transparent bail: a component that finds no live root publishes NO context, so a descendant
    // resolves against the live root itself rather than inheriting a phantom parent. mockImplementationOnce
    // makes only the first (parent's) lookup come back empty; init is top-down, so that is the layout.
    it('stays transparent to descendants when it finds no live root', async () => {
        fake.activeComponentRoot.mockImplementationOnce(() => null);

        render(Nested);
        await tick();

        expect(fake.spans().map((s) => s.name)).toEqual(['ProductPage']);
        expect(fake.spans()[0]!.parent).toEqual({ traceId: 'T', parentSpanId: 'root' });
    });
});

// Both behaviors below are Svelte internals rather than documented guarantees. They are pinned here so a
// Svelte upgrade that changes them fails loudly instead of producing a quietly wrong waterfall.
describe('measured Svelte behavior', () => {
    // Load-bearing: SvelteKit passes the page to the layout as children, so without this `+page` would
    // never nest under `+layout`. The Svelte 4 slot-context gotcha does not apply to Svelte 5 snippets.
    it('gives snippet children the context of the component that renders the snippet', async () => {
        render(Nested);
        await tick();

        const child = fake.spans().find((s) => s.name === 'ProductPage')!;
        const parent = fake.spans().find((s) => s.name === 'Layout')!;
        expect(child.parent.parentSpanId).toBe(parent.spanId);
    });

    // A parent does NOT wait for a pending {#await} branch, so its span ends before the awaited child's
    // span starts. Never assert "parent encloses child in time" anywhere in this suite.
    it('mounts an awaiting parent before its awaited child initializes', async () => {
        fake.advanceClock();

        render(AwaitNested);
        await tick();
        await new Promise((resolve) => setTimeout(resolve, 40));
        await tick();

        const parent = fake.spans().find((s) => s.name === 'Layout')!;
        const child = fake.spans().find((s) => s.name === 'ProductPage')!;

        // Parent records FIRST here, the inverse of the ordinary bottom-up order.
        expect(fake.spans().indexOf(parent)).toBeLessThan(fake.spans().indexOf(child));
        expect(child.startTimeUnixNano).toBeGreaterThan(parent.endTimeUnixNano);
        // Parent-id nesting still holds, because context is published at init.
        expect(child.parent.parentSpanId).toBe(parent.spanId);
    });
});
