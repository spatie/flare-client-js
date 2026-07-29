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

/**
 * Everything else in this suite tests one half of the feature: preprocessor.test.ts asserts on the
 * string the preprocessor emits, profileComponent.test.ts calls __flareProfileComponent by hand. That
 * leaves the join between them untested, which is where a regression would actually hide: emit a call
 * the runtime no longer honours and both halves stay green while every span disappears.
 *
 * The fixtures under tests/fixtures/preprocessed/ contain no profiling code. The preprocessor is
 * installed over them in vitest.config.mts, so these assertions run against injected code only.
 */
describe('preprocessor output at runtime', () => {
    it('records the documented pageload tree for components carrying no profiling code', async () => {
        render(Harness);
        await tick();

        const byName = Object.fromEntries(fake.spans().map((span) => [span.name, span]));

        // The names are the route-aware ones from the README table, produced end to end rather than
        // asserted against resolveProfileName in isolation. Compared as a set: onMount is bottom-up,
        // so the recording order is an implementation detail this assertion should not pin.
        expect(new Set(Object.keys(byName))).toEqual(new Set(['+layout', 'product/[id]/+page', 'AddToCartButton']));

        // Harness matches no allowlist entry, so the layout parents straight to the active root.
        expect(byName['+layout']!.parent).toEqual({ traceId: 'T', parentSpanId: 'root' });
        // The page reaches the layout only because snippet content inherits the context of the
        // component that renders the snippet. This is the assertion that fails if that ever changes.
        expect(byName['product/[id]/+page']!.parent).toEqual({
            traceId: 'T',
            parentSpanId: byName['+layout']!.spanId,
        });
        expect(byName['AddToCartButton']!.parent).toEqual({
            traceId: 'T',
            parentSpanId: byName['product/[id]/+page']!.spanId,
        });
    });

    // AddToCartButton.svelte has no instance script, so the markup hook has to add a <script> block
    // and the script hook then runs over that same block. Without the double-injection guard this
    // component records two spans, or fails to compile on a duplicate declaration.
    it('injects exactly once into a component with no instance script', async () => {
        render(Harness);
        await tick();

        expect(fake.spans().filter((span) => span.name === 'AddToCartButton')).toHaveLength(1);
    });

    // Only allowlisted components are instrumented. Harness renders and is a real component in the
    // tree, but matches nothing, so it must be invisible rather than recording an unnamed span.
    it('leaves unmatched components untouched', async () => {
        render(Harness);
        await tick();

        expect(fake.spans().map((span) => span.name)).not.toContain('Harness');
        expect(fake.spans()).toHaveLength(3);
    });
});
