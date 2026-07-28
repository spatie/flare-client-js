// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, type Component } from 'vue';

const seam = vi.hoisted(async () => (await import('@flareapp/test-helpers')).createComponentSeam());
vi.mock('@flareapp/js/browser', async (importOriginal) =>
    (await import('@flareapp/test-helpers')).componentProfilerMock(await seam, await importOriginal()),
);

import {
    createComponentMatcher,
    createComponentProfilerMixin,
    type ProfileComponentsOption,
} from '../src/profileVueComponents';

const fake = await seam;

beforeEach(() => {
    fake.reset();
});

/** The mixin, built for one allowlist. Pass it to `mount`'s `global.mixins`. */
function profiler(option: ProfileComponentsOption) {
    return createComponentProfilerMixin(createComponentMatcher(option));
}

/** Mount `component` with the profiler mixin installed for `option`. */
function mountProfiled(component: Component, option: ProfileComponentsOption) {
    return mount(component, { global: { mixins: [profiler(option)] } });
}

const Leaf = defineComponent({ name: 'Leaf', render: () => h('span', 'leaf') });
const ProductPage = defineComponent({ name: 'ProductPage', render: () => h('div', [h(Leaf)]) });

describe('component profiler mixin', () => {
    it('records one span for a matched component, parented to the active root', () => {
        mountProfiled(ProductPage, ['ProductPage']);

        expect(fake.spans()).toHaveLength(1);
        expect(fake.spans()[0]).toMatchObject({
            name: 'ProductPage',
            framework: 'vue',
            parent: { traceId: 'T', parentSpanId: 'root' },
        });
    });

    it('reads the clock twice, so the span has a real duration', () => {
        // Without the advancing clock every timestamp is the same constant, so a start/end assertion
        // could not tell two reads from one value used twice.
        fake.advanceClock();

        mountProfiled(ProductPage, ['ProductPage']);

        const span = fake.spans()[0]!;
        expect(span.endTimeUnixNano).toBeGreaterThan(span.startTimeUnixNano);
    });

    it('records nothing for a component that does not match', () => {
        const wrapper = mountProfiled(ProductPage, ['SomethingElse']);

        expect(fake.spans()).toHaveLength(0);
        expect(fake.reserveSpanId).not.toHaveBeenCalled();
        expect(wrapper.html()).toContain('leaf');
    });

    it('records nothing when no root is active, and still renders', () => {
        fake.setRoot(null);

        const wrapper = mountProfiled(ProductPage, ['ProductPage']);

        expect(fake.spans()).toHaveLength(0);
        expect(wrapper.html()).toContain('leaf');
    });

    it('never lets a throwing seam break mounting', () => {
        fake.reserveSpanId.mockImplementation(() => {
            throw new Error('seam exploded');
        });

        expect(() => mountProfiled(ProductPage, ['ProductPage'])).not.toThrow();
    });
});
