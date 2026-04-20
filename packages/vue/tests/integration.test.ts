import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';

import { FlareErrorBoundary } from '../src/FlareErrorBoundary';
import { flareVue } from '../src/flareVue';

const mockReport = vi.fn();
const mockReportMessage = vi.fn();

vi.mock('@flareapp/js', () => ({
    flare: {
        report: (...args: unknown[]) => mockReport(...args),
        reportMessage: (...args: unknown[]) => mockReportMessage(...args),
    },
}));

const ThrowingComponent = defineComponent({
    name: 'ThrowingComponent',
    setup() {
        throw new Error('integration boom');
    },
    render() {
        return h('div');
    },
});

beforeEach(() => {
    mockReport.mockReset();
    mockReportMessage.mockReset();
});

describe('FlareErrorBoundary + flareVue interop', () => {
    test('reports the error exactly once when both are installed', async () => {
        mount(FlareErrorBoundary, {
            global: {
                plugins: [[flareVue, {}]],
            },
            slots: {
                default: () => h(ThrowingComponent),
                fallback: () => h('div', 'Error'),
            },
        });

        await nextTick();

        expect(mockReport).toHaveBeenCalledOnce();
    });

    test('boundary source is the one that reports (flareVue handler is skipped)', async () => {
        const flareVueAfterSubmit = vi.fn();
        const boundaryAfterSubmit = vi.fn();

        mount(FlareErrorBoundary, {
            global: {
                plugins: [[flareVue, { afterSubmit: flareVueAfterSubmit }]],
            },
            props: { afterSubmit: boundaryAfterSubmit },
            slots: {
                default: () => h(ThrowingComponent),
                fallback: () => h('div', 'Error'),
            },
        });

        await nextTick();

        expect(boundaryAfterSubmit).toHaveBeenCalledOnce();
        expect(flareVueAfterSubmit).not.toHaveBeenCalled();
    });

    test('boundary continues to suppress flareVue even when the boundary callback modifies context', async () => {
        const flareVueAfterSubmit = vi.fn();

        mount(FlareErrorBoundary, {
            global: {
                plugins: [[flareVue, { afterSubmit: flareVueAfterSubmit }]],
            },
            props: {
                beforeSubmit: ({ context }: { context: { vue: Record<string, unknown> } }) => ({
                    ...context,
                    vue: { ...context.vue, extra: true },
                }),
            },
            slots: {
                default: () => h(ThrowingComponent),
                fallback: () => h('div', 'Error'),
            },
        });

        await nextTick();

        expect(mockReport).toHaveBeenCalledOnce();
        const context = mockReport.mock.calls[0][1];
        expect(context.vue.extra).toBe(true);
        expect(flareVueAfterSubmit).not.toHaveBeenCalled();
    });
});
