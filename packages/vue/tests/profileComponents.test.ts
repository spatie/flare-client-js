// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, type Component } from 'vue';

const seam = vi.hoisted(async () => (await import('@flareapp/test-helpers')).createComponentSeam());
vi.mock('@flareapp/js/browser', async (importOriginal) =>
    (await import('@flareapp/test-helpers')).componentProfilerMock(await seam, await importOriginal()),
);

import { flareVue } from '../src/flareVue';
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

const Gallery = defineComponent({ name: 'Gallery', render: () => h('span', 'gallery') });
const Plain = defineComponent({ name: 'Plain', render: () => h('div', [h(Gallery)]) });
const Layout = defineComponent({ name: 'Layout', render: () => h('div', [h(Plain)]) });

describe('component profiler mixin', () => {
    it('records one span for a matched component, parented to the active root', () => {
        mountProfiled(ProductPage, ['ProductPage']);

        expect(fake.spans()).toHaveLength(1);
        expect(fake.spans()[0]).toMatchObject({
            name: 'ProductPage',
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

describe('nesting', () => {
    it('nests a matched child under its matched ancestor', () => {
        mountProfiled(Layout, ['Layout', 'Gallery']);

        // mounted is bottom-up, so the child records first.
        const [child, parent] = fake.spans();
        expect(child).toMatchObject({ name: 'Gallery' });
        expect(parent).toMatchObject({ name: 'Layout' });
        expect(child!.parent.parentSpanId).toBe(parent!.spanId);
        expect(child!.parent.traceId).toBe('T');
    });

    it('treats an unmatched component in between as transparent', () => {
        // Plain is not in the allowlist, so Gallery must reach past it to Layout.
        mountProfiled(Layout, ['Layout', 'Gallery']);

        const gallery = fake.spans().find((span) => span.name === 'Gallery')!;
        const layout = fake.spans().find((span) => span.name === 'Layout')!;
        expect(gallery.parent.parentSpanId).toBe(layout.spanId);
    });

    it('parents a top-level matched component to the active root', () => {
        mountProfiled(Layout, ['Gallery']);

        expect(fake.spans()).toHaveLength(1);
        expect(fake.spans()[0]!.parent).toEqual({ traceId: 'T', parentSpanId: 'root' });
    });

    it('encloses a descendant in time, not only by parent id', () => {
        // The other tests here pin the tree by parent id. This one pins the half that makes the
        // waterfall render as a tree: beforeMount top-down puts the ancestor's start first, mounted
        // bottom-up puts its end last.
        fake.advanceClock();

        mountProfiled(Layout, ['Layout', 'Gallery']);

        const gallery = fake.spans().find((span) => span.name === 'Gallery')!;
        const layout = fake.spans().find((span) => span.name === 'Layout')!;
        expect(layout.startTimeUnixNano).toBeLessThan(gallery.startTimeUnixNano);
        expect(layout.endTimeUnixNano).toBeGreaterThan(gallery.endTimeUnixNano);
    });
});

describe('cross-trace re-homing', () => {
    it('re-homes a descendant to the live root when its ancestor belongs to a dead trace', async () => {
        // A layout that outlives the pageload trace, with the page body swapped underneath it.
        const Body = defineComponent({ name: 'Body', render: () => h('span', 'body') });
        const PersistentLayout = defineComponent({
            name: 'PersistentLayout',
            data: () => ({ showBody: false }),
            render(this: { showBody: boolean }) {
                return h('div', this.showBody ? [h(Body)] : []);
            },
        });

        // Mounted directly rather than through mountProfiled, so the wrapper keeps its precise type
        // and setData type-checks against the component's own data.
        const wrapper = mount(PersistentLayout, {
            global: { mixins: [profiler(['PersistentLayout', 'Body'])] },
        });
        expect(fake.spans()).toHaveLength(1); // the layout, under the pageload root

        // The pageload root closes and a navigation opens a new root with a new traceId.
        fake.setRoot({ traceId: 'T2', parentSpanId: 'nav' });
        await wrapper.setData({ showBody: true });

        const body = fake.spans().find((span) => span.name === 'Body')!;
        expect(body.parent).toEqual({ traceId: 'T2', parentSpanId: 'nav' });
    });
});

describe('flareVue wiring', () => {
    // The injected-flare stub shape is the one packages/vue/tests/flareVue.test.ts already uses, plus
    // `config`, which is what flareVue reads to gate tracing features.
    const install = (profileComponents?: ProfileComponentsOption, enableTracing = true) => {
        const injected = {
            config: { enableTracing },
            reportSilently: vi.fn(),
            reportMessage: vi.fn(),
            setSdkInfo: vi.fn(),
            setFramework: vi.fn(),
        } as any;

        const app = createApp(ProductPage);
        app.use(flareVue, { flare: injected, profileComponents });
        app.mount(document.createElement('div'));

        return app;
    };

    it('profiles when profileComponents is set and tracing is on', () => {
        install(['ProductPage']);

        expect(fake.spans()).toHaveLength(1);
    });

    it('registers no mixin when tracing is off', () => {
        install(['ProductPage'], false);

        expect(fake.spans()).toHaveLength(0);
        expect(fake.reserveSpanId).not.toHaveBeenCalled();
    });

    it('registers no mixin when profileComponents is absent', () => {
        install(undefined);

        expect(fake.spans()).toHaveLength(0);
    });

    it('registers no mixin for an empty allowlist', () => {
        install([]);

        expect(fake.spans()).toHaveLength(0);
        expect(fake.reserveSpanId).not.toHaveBeenCalled();
    });
});
