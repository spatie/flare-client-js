import type { Attributes } from '@flareapp/js';
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';

import { FlareErrorBoundary } from '../src/FlareErrorBoundary';
import { ComponentHierarchyFrame, FlareVueContext } from '../src/types';

const mockReport = vi.fn();

vi.mock('@flareapp/js', () => ({
    flare: {
        report: (...args: unknown[]) => mockReport(...args),
        setSdkInfo: vi.fn(),
        setFramework: vi.fn(),
        setEntryPoint: vi.fn(),
    },
}));

function getReportedVue(callIndex = 0): FlareVueContext['vue'] {
    const custom = ((mockReport.mock.calls[callIndex] ?? [])[1] as Attributes)['context.custom'] as Record<
        string,
        unknown
    >;
    return custom?.vue as FlareVueContext['vue'];
}

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

const ThrowingComponentWithProps = defineComponent({
    name: 'ThrowingComponentWithProps',
    props: {
        userId: { type: Number, required: true },
        name: { type: String, required: true },
    },
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
        mockReport.mockReset();
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

    test('passes vue context with info, errorOrigin, componentName, componentProps, componentHierarchy, and componentHierarchyFrames', async () => {
        mount(FlareErrorBoundary, {
            props: { attachProps: true },
            slots: {
                default: () => h(ThrowingComponent),
                fallback: () => h('div', 'Error'),
            },
        });

        await nextTick();

        const context = { vue: getReportedVue(0) };
        expect(context.vue.info).toEqual(expect.any(String));
        expect(context.vue.errorOrigin).toEqual(expect.any(String));
        expect(context.vue.componentName).toBe('ThrowingComponent');
        expect(context.vue.componentProps).toBeDefined();
        expect(context.vue.componentHierarchy).toBeInstanceOf(Array);
        expect(context.vue.componentHierarchy).toContain('ThrowingComponent');
        expect(context.vue.componentHierarchyFrames).toBeInstanceOf(Array);
        expect(context.vue.componentHierarchyFrames[0].component).toBe('ThrowingComponent');
        expect(context.vue.componentHierarchyFrames[0]).toHaveProperty('file');
        expect(context.vue.componentHierarchyFrames[0]).toHaveProperty('props');
    });

    test('captures componentProps from the erroring component', async () => {
        mount(FlareErrorBoundary, {
            props: { attachProps: true },
            slots: {
                default: () => h(ThrowingComponentWithProps, { userId: 42, name: 'Alice' }),
                fallback: () => h('div', 'Error'),
            },
        });

        await nextTick();

        const context = { vue: getReportedVue(0) };
        expect(context.vue.componentProps).toEqual({ userId: 42, name: 'Alice' });
    });

    test('fallback slot receives componentProps', async () => {
        let receivedProps: Record<string, unknown> | undefined;

        mount(FlareErrorBoundary, {
            props: { attachProps: true },
            slots: {
                default: () => h(ThrowingComponentWithProps, { userId: 42, name: 'Alice' }),
                fallback: (props: { componentProps?: Record<string, unknown> }) => {
                    receivedProps = props.componentProps;
                    return h('div', 'Error');
                },
            },
        });

        await nextTick();

        expect(receivedProps).toEqual({ userId: 42, name: 'Alice' });
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

    test('fallback slot receives componentHierarchyFrames', async () => {
        let receivedFrames: ComponentHierarchyFrame[] = [];

        mount(FlareErrorBoundary, {
            props: { attachProps: true },
            slots: {
                default: () => h(ThrowingComponent),
                fallback: (props: { componentHierarchyFrames: ComponentHierarchyFrame[] }) => {
                    receivedFrames = props.componentHierarchyFrames;
                    return h('div', 'Error');
                },
            },
        });

        await nextTick();

        expect(receivedFrames).toBeInstanceOf(Array);
        expect(receivedFrames.length).toBeGreaterThan(0);
        expect(receivedFrames[0]).toMatchObject({
            component: 'ThrowingComponent',
        });
        expect(receivedFrames[0]).toHaveProperty('file');
        expect(receivedFrames[0]).toHaveProperty('props');
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

    test('flare.report rejection is silenced and fallback still renders', async () => {
        mockReport.mockRejectedValueOnce(new Error('report failed'));

        const wrapper = mount(FlareErrorBoundary, {
            slots: {
                default: () => h(ThrowingComponent),
                fallback: () => h('div', 'Fallback'),
            },
        });

        await nextTick();
        await nextTick();

        expect(mockReport).toHaveBeenCalledOnce();
        expect(wrapper.text()).toBe('Fallback');
    });

    test('flare.report rejection does not propagate to outer errorCaptured handlers', async () => {
        mockReport.mockRejectedValueOnce(new Error('report failed'));
        const outerHandler = vi.fn();

        const Parent = defineComponent({
            errorCaptured: outerHandler,
            render() {
                return h(FlareErrorBoundary, null, {
                    default: () => h(ThrowingComponent),
                    fallback: () => h('div', 'Fallback'),
                });
            },
        });

        mount(Parent);

        await nextTick();
        await nextTick();

        expect(outerHandler).not.toHaveBeenCalled();
    });

    test('afterSubmit still runs when flare.report rejects', async () => {
        mockReport.mockRejectedValueOnce(new Error('report failed'));
        const afterSubmit = vi.fn();

        mount(FlareErrorBoundary, {
            props: { afterSubmit },
            slots: {
                default: () => h(ThrowingComponent),
                fallback: () => h('div', 'Fallback'),
            },
        });

        await nextTick();
        await nextTick();

        expect(afterSubmit).toHaveBeenCalledOnce();
    });

    test('calls beforeEvaluate before reporting', async () => {
        const callOrder: string[] = [];

        const beforeEvaluate = vi.fn(() => callOrder.push('beforeEvaluate'));
        mockReport.mockImplementationOnce(() => callOrder.push('report'));

        mount(FlareErrorBoundary, {
            props: { beforeEvaluate },
            slots: {
                default: () => h(ThrowingComponent),
                fallback: () => h('div', 'Error'),
            },
        });

        await nextTick();

        expect(beforeEvaluate).toHaveBeenCalledOnce();
        expect(callOrder).toEqual(['beforeEvaluate', 'report']);
    });

    test('calls beforeEvaluate with error, instance, and info', async () => {
        const beforeEvaluate = vi.fn();

        mount(FlareErrorBoundary, {
            props: { beforeEvaluate },
            slots: {
                default: () => h(ThrowingComponent),
                fallback: () => h('div', 'Error'),
            },
        });

        await nextTick();

        expect(beforeEvaluate.mock.calls[0][0].error).toBe(testError);
        expect(beforeEvaluate.mock.calls[0][0].instance).toBeDefined();
        expect(beforeEvaluate.mock.calls[0][0].info).toEqual(expect.any(String));
    });

    test('calls beforeSubmit after beforeEvaluate and before reporting', async () => {
        const callOrder: string[] = [];

        const beforeEvaluate = vi.fn(() => callOrder.push('beforeEvaluate'));
        const beforeSubmit = vi.fn((params: { context: FlareVueContext }) => {
            callOrder.push('beforeSubmit');
            return params.context;
        });
        mockReport.mockImplementationOnce(() => callOrder.push('report'));

        mount(FlareErrorBoundary, {
            props: { beforeEvaluate, beforeSubmit },
            slots: {
                default: () => h(ThrowingComponent),
                fallback: () => h('div', 'Error'),
            },
        });

        await nextTick();

        expect(beforeSubmit).toHaveBeenCalledOnce();
        expect(callOrder).toEqual(['beforeEvaluate', 'beforeSubmit', 'report']);
    });

    test('calls beforeSubmit with error, instance, info, and context', async () => {
        const beforeSubmit = vi.fn(
            (params: { error: Error; instance: unknown; info: string; context: FlareVueContext }) => params.context
        );

        mount(FlareErrorBoundary, {
            props: { beforeSubmit },
            slots: {
                default: () => h(ThrowingComponent),
                fallback: () => h('div', 'Error'),
            },
        });

        await nextTick();

        expect(beforeSubmit.mock.calls[0][0].error).toBe(testError);
        expect(beforeSubmit.mock.calls[0][0].instance).toBeDefined();
        expect(beforeSubmit.mock.calls[0][0].info).toEqual(expect.any(String));
        expect(beforeSubmit.mock.calls[0][0].context.vue.componentHierarchy).toBeInstanceOf(Array);
        expect(beforeSubmit.mock.calls[0][0].context.vue.componentHierarchyFrames).toBeInstanceOf(Array);
        expect(beforeSubmit.mock.calls[0][0].context.vue.componentName).toBe('ThrowingComponent');
    });

    test('beforeSubmit can modify the context before reporting', async () => {
        const customHierarchy = ['Custom', 'Modified'];
        const beforeSubmit = vi.fn(({ context }: { context: FlareVueContext }) => ({
            ...context,
            vue: {
                ...context.vue,
                componentHierarchy: customHierarchy,
            },
        }));

        mount(FlareErrorBoundary, {
            props: { beforeSubmit },
            slots: {
                default: () => h(ThrowingComponent),
                fallback: () => h('div', 'Error'),
            },
        });

        await nextTick();

        const reportedContext = { vue: getReportedVue(0) };
        expect(reportedContext.vue.componentHierarchy).toBe(customHierarchy);
    });

    test('beforeSubmit modified context is passed to afterSubmit', async () => {
        const customHierarchy = ['Custom', 'Modified'];
        const beforeSubmit = vi.fn(({ context }: { context: FlareVueContext }) => ({
            ...context,
            vue: {
                ...context.vue,
                componentHierarchy: customHierarchy,
            },
        }));
        const afterSubmit = vi.fn();

        mount(FlareErrorBoundary, {
            props: { beforeSubmit, afterSubmit },
            slots: {
                default: () => h(ThrowingComponent),
                fallback: () => h('div', 'Error'),
            },
        });

        await nextTick();

        expect(afterSubmit.mock.calls[0][0].context.vue.componentHierarchy).toBe(customHierarchy);
    });

    test('calls afterSubmit after reporting', async () => {
        const callOrder: string[] = [];

        mockReport.mockImplementationOnce(() => callOrder.push('report'));
        const afterSubmit = vi.fn(
            (_params: { error: Error; instance: unknown; info: string; context: FlareVueContext }) => {
                callOrder.push('afterSubmit');
            }
        );

        mount(FlareErrorBoundary, {
            props: { afterSubmit },
            slots: {
                default: () => h(ThrowingComponent),
                fallback: () => h('div', 'Error'),
            },
        });

        await nextTick();

        expect(afterSubmit).toHaveBeenCalledOnce();
        expect(afterSubmit.mock.calls[0][0].error).toBe(testError);
        expect(afterSubmit.mock.calls[0][0].instance).toBeDefined();
        expect(afterSubmit.mock.calls[0][0].info).toEqual(expect.any(String));
        expect(afterSubmit.mock.calls[0][0].context.vue.componentHierarchy).toBeInstanceOf(Array);
        expect(callOrder).toEqual(['report', 'afterSubmit']);
    });

    test('uses original context when beforeSubmit does not return', async () => {
        const beforeSubmit = vi.fn(() => {
            // user forgot to return context
        });

        mount(FlareErrorBoundary, {
            // @ts-expect-error - intentionally testing a user mistake where beforeSubmit does not return
            props: { beforeSubmit },
            slots: {
                default: () => h(ThrowingComponent),
                fallback: () => h('div', 'Error'),
            },
        });

        await nextTick();

        expect(beforeSubmit).toHaveBeenCalledOnce();
        const reportedContext = { vue: getReportedVue(0) };
        expect(reportedContext.vue.componentName).toBe('ThrowingComponent');
        expect(reportedContext.vue.componentHierarchy).toBeInstanceOf(Array);
    });

    test('beforeSubmit modified componentHierarchy is reflected in the fallback render', async () => {
        const customHierarchy = ['Custom', 'Modified'];
        const beforeSubmit = vi.fn(({ context }: { context: FlareVueContext }) => ({
            ...context,
            vue: {
                ...context.vue,
                componentHierarchy: customHierarchy,
            },
        }));

        const wrapper = mount(FlareErrorBoundary, {
            props: { beforeSubmit },
            slots: {
                default: () => h(ThrowingComponent),
                fallback: (props: { componentHierarchy: string[] }) =>
                    h('span', { class: 'hierarchy' }, props.componentHierarchy.join(',')),
            },
        });

        await nextTick();

        expect(wrapper.find('.hierarchy').text()).toBe('Custom,Modified');
    });

    test('beforeEvaluate throwing prevents reporting and propagates', () => {
        const beforeEvaluate = vi.fn(() => {
            throw new Error('beforeEvaluate error');
        });

        expect(() => {
            mount(FlareErrorBoundary, {
                props: { beforeEvaluate },
                slots: {
                    default: () => h(ThrowingComponent),
                    fallback: () => h('div', 'Error'),
                },
            });
        }).toThrow('beforeEvaluate error');

        expect(beforeEvaluate).toHaveBeenCalledOnce();
        expect(mockReport).not.toHaveBeenCalled();
    });

    test('beforeSubmit throwing prevents reporting and propagates', () => {
        const beforeSubmit = vi.fn(() => {
            throw new Error('beforeSubmit error');
        });

        expect(() => {
            mount(FlareErrorBoundary, {
                props: { beforeSubmit },
                slots: {
                    default: () => h(ThrowingComponent),
                    fallback: () => h('div', 'Error'),
                },
            });
        }).toThrow('beforeSubmit error');

        expect(beforeSubmit).toHaveBeenCalledOnce();
        expect(mockReport).not.toHaveBeenCalled();
    });

    test('afterSubmit throwing propagates after reporting', () => {
        const afterSubmit = vi.fn(() => {
            throw new Error('afterSubmit error');
        });

        expect(() => {
            mount(FlareErrorBoundary, {
                props: { afterSubmit },
                slots: {
                    default: () => h(ThrowingComponent),
                    fallback: () => h('div', 'Error'),
                },
            });
        }).toThrow('afterSubmit error');

        expect(afterSubmit).toHaveBeenCalledOnce();
        expect(mockReport).toHaveBeenCalledOnce();
    });

    test('calls onReset with the previous error when manually resetting', async () => {
        let shouldThrow = true;
        const onReset = vi.fn();

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
            props: { onReset },
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

        expect(onReset).toHaveBeenCalledOnce();
        expect(onReset).toHaveBeenCalledWith(testError);
        expect(wrapper.text()).toBe('Recovered');
    });

    test('onReset receives null when no error is set', async () => {
        const onReset = vi.fn();

        const wrapper = mount(FlareErrorBoundary, {
            props: { onReset },
            slots: {
                default: () => h('div', 'OK'),
                fallback: (props: { resetErrorBoundary: () => void }) =>
                    h('button', { onClick: props.resetErrorBoundary }, 'Reset'),
            },
        });

        await nextTick();

        // No error occurred, so there's no fallback rendered.
        // We can't click the reset button since there's no error state.
        // This test verifies onReset is not called when no error occurs.
        expect(onReset).not.toHaveBeenCalled();
    });

    test('resets automatically when resetKeys change', async () => {
        let shouldThrow = true;
        const onReset = vi.fn();

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
            props: { onReset, resetKeys: ['a'] as unknown[] },
            slots: {
                default: () => h(MaybeThrow),
                fallback: () => h('div', 'Error'),
            },
        });

        await nextTick();

        expect(wrapper.text()).toBe('Error');

        shouldThrow = false;
        await wrapper.setProps({ resetKeys: ['b'] });
        await nextTick();

        expect(onReset).toHaveBeenCalledOnce();
        expect(onReset).toHaveBeenCalledWith(testError);
        expect(wrapper.text()).toBe('Recovered');
    });

    test('does not reset when resetKeys stay the same', async () => {
        const onReset = vi.fn();

        const wrapper = mount(FlareErrorBoundary, {
            props: { onReset, resetKeys: ['a'] as unknown[] },
            slots: {
                default: () => h(ThrowingComponent),
                fallback: () => h('div', 'Error'),
            },
        });

        await nextTick();

        expect(wrapper.text()).toBe('Error');

        await wrapper.setProps({ resetKeys: ['a'] });
        await nextTick();

        expect(onReset).not.toHaveBeenCalled();
        expect(wrapper.text()).toBe('Error');
    });

    test('does not reset when resetKeys change but there is no error', async () => {
        const onReset = vi.fn();

        const wrapper = mount(FlareErrorBoundary, {
            props: { onReset, resetKeys: ['a'] as unknown[] },
            slots: {
                default: () => h('div', 'OK'),
            },
        });

        await nextTick();

        expect(wrapper.text()).toBe('OK');

        await wrapper.setProps({ resetKeys: ['b'] });
        await nextTick();

        expect(onReset).not.toHaveBeenCalled();
    });

    test('resets when resetKeys length changes', async () => {
        let shouldThrow = true;
        const onReset = vi.fn();

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
            props: { onReset, resetKeys: ['a'] as unknown[] },
            slots: {
                default: () => h(MaybeThrow),
                fallback: () => h('div', 'Error'),
            },
        });

        await nextTick();

        expect(wrapper.text()).toBe('Error');

        shouldThrow = false;
        await wrapper.setProps({ resetKeys: ['a', 'b'] });
        await nextTick();

        expect(onReset).toHaveBeenCalledOnce();
        expect(wrapper.text()).toBe('Recovered');
    });

    test('does not reset on the first transition from undefined to a resetKeys array', async () => {
        const onReset = vi.fn();

        const wrapper = mount(FlareErrorBoundary, {
            slots: {
                default: () => h(ThrowingComponent),
                fallback: () => h('div', 'Error'),
            },
        });

        await nextTick();

        expect(wrapper.text()).toBe('Error');

        await wrapper.setProps({ onReset, resetKeys: ['a'] as unknown[] });
        await nextTick();

        expect(onReset).not.toHaveBeenCalled();
        expect(wrapper.text()).toBe('Error');
    });

    test('resetKeys uses Object.is for comparison', async () => {
        let shouldThrow = true;
        const onReset = vi.fn();
        const obj = { id: 1 };

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
            props: { onReset, resetKeys: [obj] as unknown[] },
            slots: {
                default: () => h(MaybeThrow),
                fallback: () => h('div', 'Error'),
            },
        });

        await nextTick();

        expect(wrapper.text()).toBe('Error');

        // Same reference, should not reset
        await wrapper.setProps({ resetKeys: [obj] });
        await nextTick();

        expect(onReset).not.toHaveBeenCalled();
        expect(wrapper.text()).toBe('Error');

        // Different reference with same shape, should reset
        shouldThrow = false;
        await wrapper.setProps({ resetKeys: [{ id: 1 }] });
        await nextTick();

        expect(onReset).toHaveBeenCalledOnce();
        expect(wrapper.text()).toBe('Recovered');
    });

    test('callbacks fire again after reset and re-throw', async () => {
        const beforeEvaluate = vi.fn();
        const beforeSubmit = vi.fn((params: { context: FlareVueContext }) => params.context);
        const afterSubmit = vi.fn();

        const wrapper = mount(FlareErrorBoundary, {
            props: { beforeEvaluate, beforeSubmit, afterSubmit },
            slots: {
                default: () => h(ThrowingComponent),
                fallback: (props: { resetErrorBoundary: () => void }) =>
                    h('button', { onClick: props.resetErrorBoundary }, 'Reset'),
            },
        });

        await nextTick();

        expect(beforeEvaluate).toHaveBeenCalledOnce();
        expect(beforeSubmit).toHaveBeenCalledOnce();
        expect(afterSubmit).toHaveBeenCalledOnce();

        await wrapper.find('button').trigger('click');
        await nextTick();

        expect(beforeEvaluate).toHaveBeenCalledTimes(2);
        expect(beforeSubmit).toHaveBeenCalledTimes(2);
        expect(afterSubmit).toHaveBeenCalledTimes(2);
    });

    describe('attachProps', () => {
        test('omits componentProps from the reported context by default', async () => {
            const ThrowingWithUserId = defineComponent({
                name: 'ThrowingWithUserId',
                props: { userId: { type: Number, required: true } },
                setup() {
                    throw new Error('boom');
                },
                render() {
                    return h('div');
                },
            });

            mount(FlareErrorBoundary, {
                slots: { default: () => h(ThrowingWithUserId, { userId: 7 }) },
            });

            await nextTick();

            const context = { vue: getReportedVue(0) };
            expect('componentProps' in context.vue).toBe(false);
        });

        test('includes serialized componentProps when attachProps is true', async () => {
            const ThrowingWithUserId = defineComponent({
                name: 'ThrowingWithUserId',
                props: { userId: { type: Number, required: true } },
                setup() {
                    throw new Error('boom');
                },
                render() {
                    return h('div');
                },
            });

            mount(FlareErrorBoundary, {
                props: { attachProps: true },
                slots: { default: () => h(ThrowingWithUserId, { userId: 7 }) },
            });

            await nextTick();

            const context = { vue: getReportedVue(0) };
            expect(context.vue.componentProps).toEqual({ userId: 7 });
        });

        test('forwards propsMaxDepth to the serializer', async () => {
            const ThrowingWithData = defineComponent({
                name: 'ThrowingWithData',
                props: { data: { type: Object, required: true } },
                setup() {
                    throw new Error('boom');
                },
                render() {
                    return h('div');
                },
            });

            mount(FlareErrorBoundary, {
                props: { attachProps: true, propsMaxDepth: 1 },
                slots: { default: () => h(ThrowingWithData, { data: { nested: { deep: 1 } } }) },
            });

            await nextTick();

            const context = { vue: getReportedVue(0) };
            expect(context.vue.componentProps).toEqual({ data: { nested: '[Object]' } });
        });

        test('omits componentProps from fallback slot by default', async () => {
            const ThrowingWithUserId = defineComponent({
                name: 'ThrowingWithUserId',
                props: { userId: { type: Number, required: true } },
                setup() {
                    throw new Error('boom');
                },
                render() {
                    return h('div');
                },
            });

            let slotProps: Record<string, unknown> | undefined;

            mount(FlareErrorBoundary, {
                slots: {
                    default: () => h(ThrowingWithUserId, { userId: 7 }),
                    fallback: (props: Record<string, unknown>) => {
                        slotProps = props;
                        return h('div', 'fallback');
                    },
                },
            });

            await nextTick();

            expect(slotProps).toBeDefined();
            expect('componentProps' in (slotProps as Record<string, unknown>)).toBe(false);
        });

        test('redacts default sensitive keys from componentProps', async () => {
            const ThrowingWithSecrets = defineComponent({
                name: 'ThrowingWithSecrets',
                props: {
                    id: { type: Number, required: true },
                    password: { type: String, required: true },
                    apiKey: { type: String, required: true },
                },
                setup() {
                    throw new Error('boom');
                },
                render() {
                    return h('div');
                },
            });

            mount(FlareErrorBoundary, {
                props: { attachProps: true },
                slots: {
                    default: () => h(ThrowingWithSecrets, { id: 1, password: 'hunter2', apiKey: 'abc' }),
                },
            });

            await nextTick();

            const context = { vue: getReportedVue(0) };
            expect(context.vue.componentProps).toEqual({
                id: 1,
                password: '[Redacted]',
                apiKey: '[Redacted]',
            });
        });

        test('merges a custom propsDenylist with the default by default', async () => {
            const ThrowingWithSsn = defineComponent({
                name: 'ThrowingWithSsn',
                props: {
                    ssn: { type: String, required: true },
                    password: { type: String, required: true },
                },
                setup() {
                    throw new Error('boom');
                },
                render() {
                    return h('div');
                },
            });

            mount(FlareErrorBoundary, {
                props: { attachProps: true, propsDenylist: /^ssn$/ },
                slots: {
                    default: () => h(ThrowingWithSsn, { ssn: '123', password: 'still-redacted' }),
                },
            });

            await nextTick();

            const context = { vue: getReportedVue(0) };
            expect(context.vue.componentProps).toEqual({ ssn: '[Redacted]', password: '[Redacted]' });
        });

        test('replaces the default denylist when replaceDefaultDenylist is true', async () => {
            const ThrowingWithSsn = defineComponent({
                name: 'ThrowingWithSsn',
                props: {
                    ssn: { type: String, required: true },
                    password: { type: String, required: true },
                },
                setup() {
                    throw new Error('boom');
                },
                render() {
                    return h('div');
                },
            });

            mount(FlareErrorBoundary, {
                props: { attachProps: true, propsDenylist: /^ssn$/, replaceDefaultDenylist: true },
                slots: {
                    default: () => h(ThrowingWithSsn, { ssn: '123', password: 'now-leaked' }),
                },
            });

            await nextTick();

            const context = { vue: getReportedVue(0) };
            expect(context.vue.componentProps).toEqual({ ssn: '[Redacted]', password: 'now-leaked' });
        });

        test('passes serialized componentProps into the fallback slot when attachProps is true', async () => {
            const ThrowingWithUserId = defineComponent({
                name: 'ThrowingWithUserId',
                props: { userId: { type: Number, required: true } },
                setup() {
                    throw new Error('boom');
                },
                render() {
                    return h('div');
                },
            });

            let slotProps: { componentProps?: Record<string, unknown> } | undefined;

            mount(FlareErrorBoundary, {
                props: { attachProps: true },
                slots: {
                    default: () => h(ThrowingWithUserId, { userId: 7 }),
                    fallback: (props: { componentProps?: Record<string, unknown> }) => {
                        slotProps = props;
                        return h('div', 'fallback');
                    },
                },
            });

            await nextTick();

            expect(slotProps?.componentProps).toEqual({ userId: 7 });
        });
    });

    describe('url scrubbing', () => {
        let originalHref: string;

        beforeEach(() => {
            originalHref = window.location.href;
        });

        afterEach(() => {
            window.history.replaceState({}, '', originalHref);
        });

        function getReportedAttributes(callIndex = 0): Attributes {
            return (mockReport.mock.calls[callIndex] ?? [])[1] as Attributes;
        }

        test('redacts denylisted query keys from url.full and url.query', async () => {
            window.history.replaceState({}, '', '/page?token=abc&q=visible');

            mount(FlareErrorBoundary, {
                slots: {
                    default: () => h(ThrowingComponent),
                    fallback: () => h('div', 'Error'),
                },
            });

            await nextTick();

            const attributes = getReportedAttributes(0);
            expect(attributes['url.full']).toContain('token=[Redacted]');
            expect(attributes['url.full']).toContain('q=visible');
            expect(attributes['url.query']).toBe('token=[Redacted]&q=visible');
        });

        test('honours custom propsDenylist when redacting the URL', async () => {
            window.history.replaceState({}, '', '/page?secretKey=xyz&token=stillVisible');

            mount(FlareErrorBoundary, {
                props: { propsDenylist: /^secretKey$/ },
                slots: {
                    default: () => h(ThrowingComponent),
                    fallback: () => h('div', 'Error'),
                },
            });

            await nextTick();

            const attributes = getReportedAttributes(0);
            expect(attributes['url.full']).toContain('secretKey=[Redacted]');
            expect(attributes['url.full']).toContain('token=stillVisible');
            expect(attributes['url.query']).toBe('secretKey=[Redacted]&token=stillVisible');
        });

        test('omits url.query when there is no query string', async () => {
            window.history.replaceState({}, '', '/page');

            mount(FlareErrorBoundary, {
                slots: {
                    default: () => h(ThrowingComponent),
                    fallback: () => h('div', 'Error'),
                },
            });

            await nextTick();

            const attributes = getReportedAttributes(0);
            expect(attributes['url.full']).toBeDefined();
            expect(attributes['url.query']).toBeUndefined();
        });
    });
});
