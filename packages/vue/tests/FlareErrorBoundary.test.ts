import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';

import { FlareErrorBoundary } from '../src/FlareErrorBoundary';

const mockReport = vi.fn();

vi.mock('@flareapp/js', () => ({
    flare: {
        report: (...args: unknown[]) => mockReport(...args),
    },
}));

let testError: Error;

const ThrowingComponent = defineComponent({
    name: 'ThrowingComponent',
    setup() {
        throw testError;
    },
    render() {
        return h('div', 'should not render');
    },
});

describe('FlareErrorBoundary', () => {
    let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        testError = new Error('test error');
        mockReport.mockClear();
        consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleWarnSpy.mockRestore();
    });

    test('renders default slot when there is no error', () => {
        const wrapper = mount(FlareErrorBoundary, {
            slots: {
                default: () => h('div', 'Hello'),
            },
        });

        expect(wrapper.text()).toBe('Hello');
    });

    test('reports the error to flare', async () => {
        mount(FlareErrorBoundary, {
            slots: {
                default: () => h(ThrowingComponent),
                fallback: () => h('div', 'Error'),
            },
        });

        await nextTick();

        expect(mockReport).toHaveBeenCalledOnce();
        expect(mockReport.mock.calls[0][0]).toBe(testError);
    });

    test('passes vue context with info, componentName, and componentHierarchy', async () => {
        mount(FlareErrorBoundary, {
            slots: {
                default: () => h(ThrowingComponent),
                fallback: () => h('div', 'Error'),
            },
        });

        await nextTick();

        const context = mockReport.mock.calls[0][1];
        expect(context.vue.info).toEqual(expect.any(String));
        expect(context.vue.componentName).toBe('ThrowingComponent');
        expect(context.vue.componentHierarchy).toBeInstanceOf(Array);
        expect(context.vue.componentHierarchy).toContain('ThrowingComponent');
    });

    test('passes instance and info as extra solution parameters', async () => {
        mount(FlareErrorBoundary, {
            slots: {
                default: () => h(ThrowingComponent),
                fallback: () => h('div', 'Error'),
            },
        });

        await nextTick();

        const extraParams = mockReport.mock.calls[0][2];
        expect(extraParams.vue.instance).toBeDefined();
        expect(extraParams.vue.info).toEqual(expect.any(String));
    });

    test('renders nothing when no fallback is provided on error', async () => {
        const wrapper = mount(FlareErrorBoundary, {
            slots: {
                default: () => h(ThrowingComponent),
            },
        });

        await nextTick();

        expect(wrapper.html()).toBe('');
    });

    test('renders fallback slot on error', async () => {
        const wrapper = mount(FlareErrorBoundary, {
            slots: {
                default: () => h(ThrowingComponent),
                fallback: () => h('div', 'Something went wrong'),
            },
        });

        await nextTick();

        expect(wrapper.text()).toBe('Something went wrong');
    });

    test('fallback slot receives error and componentHierarchy', async () => {
        const wrapper = mount(FlareErrorBoundary, {
            slots: {
                default: () => h(ThrowingComponent),
                fallback: (props: { error: Error; componentHierarchy: string[] }) =>
                    h('div', [
                        h('span', { class: 'error-msg' }, props.error.message),
                        h('span', { class: 'hierarchy' }, props.componentHierarchy.join(',')),
                    ]),
            },
        });

        await nextTick();

        expect(wrapper.find('.error-msg').text()).toBe('test error');
        expect(wrapper.find('.hierarchy').text()).toContain('ThrowingComponent');
    });

    test('fallback slot receives resetErrorBoundary function', async () => {
        const wrapper = mount(FlareErrorBoundary, {
            slots: {
                default: () => h(ThrowingComponent),
                fallback: (props: { resetErrorBoundary: () => void }) =>
                    h('button', { onClick: props.resetErrorBoundary }, 'Reset'),
            },
        });

        await nextTick();

        expect(wrapper.find('button').exists()).toBe(true);
        expect(wrapper.find('button').text()).toBe('Reset');
    });

    test('resetErrorBoundary clears the error and re-renders default slot', async () => {
        let shouldThrow = true;

        const MaybeThrow = defineComponent({
            name: 'MaybeThrow',
            setup() {
                if (shouldThrow) {
                    throw testError;
                }
            },
            render() {
                return h('div', 'Recovered');
            },
        });

        const wrapper = mount(FlareErrorBoundary, {
            slots: {
                default: () => h(MaybeThrow),
                fallback: (props: { resetErrorBoundary: () => void }) =>
                    h('button', { onClick: props.resetErrorBoundary }, 'Reset'),
            },
        });

        await nextTick();

        expect(wrapper.find('button').text()).toBe('Reset');

        shouldThrow = false;
        await wrapper.find('button').trigger('click');
        await nextTick();

        expect(wrapper.text()).toBe('Recovered');
    });

    test('converts non-Error values to Error before reporting', async () => {
        const StringThrowingComponent = defineComponent({
            name: 'StringThrower',
            setup() {
                throw 'string error';
            },
            render() {
                return h('div');
            },
        });

        mount(FlareErrorBoundary, {
            slots: {
                default: () => h(StringThrowingComponent),
                fallback: () => h('div', 'Error'),
            },
        });

        await nextTick();

        const reportedError = mockReport.mock.calls[0][0];
        expect(reportedError).toBeInstanceOf(Error);
        expect(reportedError.message).toBe('string error');
    });

    test('reports again after reset when component throws again', async () => {
        const wrapper = mount(FlareErrorBoundary, {
            slots: {
                default: () => h(ThrowingComponent),
                fallback: (props: { resetErrorBoundary: () => void }) =>
                    h('button', { onClick: props.resetErrorBoundary }, 'Reset'),
            },
        });

        await nextTick();

        expect(mockReport).toHaveBeenCalledOnce();

        await wrapper.find('button').trigger('click');
        await nextTick();

        expect(mockReport).toHaveBeenCalledTimes(2);
    });

    test('prevents error from propagating to parent error handler', async () => {
        const parentHandler = vi.fn();

        const Parent = defineComponent({
            setup() {
                return {};
            },
            errorCaptured: parentHandler,
            render() {
                return h(FlareErrorBoundary, null, {
                    default: () => h(ThrowingComponent),
                    fallback: () => h('div', 'Error'),
                });
            },
        });

        mount(Parent);

        await nextTick();

        expect(mockReport).toHaveBeenCalledOnce();
        expect(parentHandler).not.toHaveBeenCalled();
    });

    test('inner boundary catches error without outer boundary reporting', async () => {
        const wrapper = mount(FlareErrorBoundary, {
            slots: {
                default: () =>
                    h(FlareErrorBoundary, null, {
                        default: () => h(ThrowingComponent),
                        fallback: () => h('div', 'Inner fallback'),
                    }),
                fallback: () => h('div', 'Outer fallback'),
            },
        });

        await nextTick();

        expect(mockReport).toHaveBeenCalledOnce();
        expect(wrapper.text()).toBe('Inner fallback');
    });

    test('renders nothing when no default slot is provided', () => {
        const wrapper = mount(FlareErrorBoundary);

        expect(wrapper.html()).toBe('');
    });

    test('error propagates when flare.report() throws', () => {
        mockReport.mockImplementation(() => {
            throw new Error('report failed');
        });

        // When flare.report() throws inside onErrorCaptured, the `return false` is never
        // reached, so the error propagates instead of being contained by the boundary.
        expect(() => {
            mount(FlareErrorBoundary, {
                slots: {
                    default: () => h(ThrowingComponent),
                    fallback: () => h('div', 'Fallback'),
                },
            });
        }).toThrow('report failed');
    });
});
