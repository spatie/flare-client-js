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
import PersistentLayout from './fixtures/profile/PersistentLayout.svelte';

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

    // Doubles as the SSR case: on the server there's no active root either. No separate server test,
    // because @testing-library/svelte only compiles for the client.
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

    // The test above only covers init. This one runs inside onMount, which needs its own guard.
    it('never throws into the host when the deferred record throws', () => {
        fake.recordComponentSpan.mockImplementation(() => {
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

    it('re-homes a descendant to the live root when a persistent ancestor holds a stale context', async () => {
        // rerender, not a fresh render, so the layout stays the same instance and its context stays
        // stuck on T. The child is what we're actually testing here.
        const { rerender } = render(PersistentLayout, { props: { show: false } });
        await tick();

        // A navigation opens a new root, and the child appears without the layout remounting.
        fake.setRoot({ traceId: 'T2', parentSpanId: 'nav-root' });
        await rerender({ show: true });
        await tick();

        const layout = fake.spans().find((s) => s.name === 'Layout')!;
        const page = fake.spans().find((s) => s.name === 'ProductPage')!;

        expect(layout.parent).toEqual({ traceId: 'T', parentSpanId: 'root' });
        // The child inherited the stale T context but re-homes to T2 rather than a dead trace.
        expect(page.parent).toEqual({ traceId: 'T2', parentSpanId: 'nav-root' });
    });

    // The tree follows the allowlist, not the real component tree. Unmatched components never get the
    // call injected, so they just pass their context through.
    it('nests under the nearest MATCHED ancestor, skipping unprofiled components in between', async () => {
        render(DeepNested);
        await tick();

        const layout = fake.spans().find((s) => s.name === 'Layout')!;
        const page = fake.spans().find((s) => s.name === 'ProductPage')!;

        expect(fake.spans()).toHaveLength(2);
        expect(page.parent).toEqual({ traceId: 'T', parentSpanId: layout.spanId });
    });

    // Publishing no context means descendants resolve against the live root instead of inheriting a
    // phantom parent. mockImplementationOnce only empties the first lookup, which is the layout's.
    it('stays transparent to descendants when it finds no live root', async () => {
        fake.activeComponentRoot.mockImplementationOnce(() => null);

        render(Nested);
        await tick();

        expect(fake.spans().map((s) => s.name)).toEqual(['ProductPage']);
        expect(fake.spans()[0]!.parent).toEqual({ traceId: 'T', parentSpanId: 'root' });
    });
});

// Neither of these is documented by Svelte, so pin them. A version that changes them should fail here
// rather than quietly produce a wrong waterfall.
describe('measured Svelte behavior', () => {
    // SvelteKit hands the page to the layout as children, so without this `+page` would never nest
    // under `+layout`.
    it('gives snippet children the context of the component that renders the snippet', async () => {
        render(Nested);
        await tick();

        const child = fake.spans().find((s) => s.name === 'ProductPage')!;
        const parent = fake.spans().find((s) => s.name === 'Layout')!;
        expect(child.parent.parentSpanId).toBe(parent.spanId);
    });

    // A parent doesn't wait for a pending {#await} branch, so its span ends before the child's starts.
    // Never assert that a parent encloses its child in time.
    it('mounts an awaiting parent before its awaited child initializes', async () => {
        fake.advanceClock();

        render(AwaitNested);
        await tick();
        await new Promise((resolve) => setTimeout(resolve, 40));
        await tick();

        const parent = fake.spans().find((s) => s.name === 'Layout')!;
        const child = fake.spans().find((s) => s.name === 'ProductPage')!;

        // Parent records first here, the opposite of the usual bottom-up order.
        expect(fake.spans().indexOf(parent)).toBeLessThan(fake.spans().indexOf(child));
        expect(child.startTimeUnixNano).toBeGreaterThan(parent.endTimeUnixNano);
        // Nesting by id still holds, because context is published at init.
        expect(child.parent.parentSpanId).toBe(parent.spanId);
    });
});
