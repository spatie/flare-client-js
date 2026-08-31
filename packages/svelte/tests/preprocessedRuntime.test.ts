import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const seam = vi.hoisted(async () => (await import('@flareapp/test-helpers')).createComponentSeam());
vi.mock('@flareapp/js/browser', async (importOriginal) =>
    (await import('@flareapp/test-helpers')).componentProfilerMock(await seam, await importOriginal()),
);

import Harness from './fixtures/preprocessed/Harness.svelte';

const fake = await seam;

beforeEach(() => {
    fake.reset();
});

// preprocessor.test.ts checks what we emit; profileComponent.test.ts calls the function directly.
// Neither notices if the emitted call breaks, so this test fills that gap. The fixtures hold no
// profiling code themselves — vitest.config.mts injects it.
describe('preprocessor output at runtime', () => {
    it('records the documented pageload tree for components carrying no profiling code', async () => {
        render(Harness);
        await tick();

        const byName = Object.fromEntries(fake.spans().map((span) => [span.name, span]));

        // A set, because onMount runs bottom-up and we don't want to pin the recording order.
        expect(new Set(Object.keys(byName))).toEqual(new Set(['+layout', 'product/[id]/+page', 'AddToCartButton']));

        // Harness isn't in the allowlist, so the layout parents straight to the root.
        expect(byName['+layout']!.parent).toEqual({ traceId: 'T', parentSpanId: 'root' });
        // Only works because snippet content picks up the context of whoever renders it. If Svelte
        // ever changes that, this is the test that breaks.
        expect(byName['product/[id]/+page']!.parent).toEqual({
            traceId: 'T',
            parentSpanId: byName['+layout']!.spanId,
        });
        expect(byName['AddToCartButton']!.parent).toEqual({
            traceId: 'T',
            parentSpanId: byName['product/[id]/+page']!.spanId,
        });
    });

    // The markup hook has to create an instance script for this component, since it has none of its own.
    it('injects exactly once into a component with no instance script', async () => {
        render(Harness);
        await tick();

        expect(fake.spans().filter((span) => span.name === 'AddToCartButton')).toHaveLength(1);
    });

    // Harness is a real component in the tree but matches nothing, so it should stay invisible.
    it('leaves unmatched components untouched', async () => {
        render(Harness);
        await tick();

        expect(fake.spans().map((span) => span.name)).not.toContain('Harness');
        expect(fake.spans()).toHaveLength(3);
    });
});
