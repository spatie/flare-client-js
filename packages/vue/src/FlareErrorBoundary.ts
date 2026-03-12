import { flare } from '@flareapp/js';
import type { ComponentPublicInstance, PropType } from 'vue';
import { defineComponent, onErrorCaptured, ref, watch } from 'vue';

import { buildComponentHierarchy } from './buildComponentHierarchy';
import { buildComponentHierarchyFrames } from './buildComponentHierarchyFrames';
import { convertToError } from './convertToError';
import { getComponentName } from './getComponentName';
import { getErrorOrigin } from './getErrorOrigin';
import { ComponentHierarchyFrame, FlareErrorBoundaryHookParams, FlareVueContext } from './types';

export const FlareErrorBoundary = defineComponent({
    name: 'FlareErrorBoundary',

    props: {
        beforeEvaluate: {
            type: Function as PropType<(params: FlareErrorBoundaryHookParams) => void>,
            default: undefined,
        },
        beforeSubmit: {
            type: Function as PropType<
                (params: FlareErrorBoundaryHookParams & { context: FlareVueContext }) => FlareVueContext
            >,
            default: undefined,
        },
        afterSubmit: {
            type: Function as PropType<(params: FlareErrorBoundaryHookParams & { context: FlareVueContext }) => void>,
            default: undefined,
        },
        onReset: {
            type: Function as PropType<(error: Error | null) => void>,
            default: undefined,
        },
        resetKeys: {
            type: Array as PropType<unknown[]>,
            default: undefined,
        },
    },

    setup(props, { slots }) {
        const error = ref<Error | null>(null);
        const componentProps = ref<Record<string, unknown> | null>(null);
        const componentHierarchy = ref<string[]>([]);
        const componentHierarchyFrames = ref<ComponentHierarchyFrame[]>([]);

        const resetErrorBoundary = () => {
            props.onReset?.(error.value);

            error.value = null;
            componentProps.value = null;
            componentHierarchy.value = [];
            componentHierarchyFrames.value = [];
        };

        watch(
            () => props.resetKeys,
            (nextKeys, prevKeys) => {
                if (error.value === null || !nextKeys) {
                    return;
                }

                const lengthChanged = prevKeys?.length !== nextKeys.length;
                const valuesChanged = nextKeys.some((key, i) => !Object.is(key, prevKeys?.[i]));

                if (lengthChanged || valuesChanged) {
                    resetErrorBoundary();
                }
            }
        );

        onErrorCaptured((currentError: unknown, instance: ComponentPublicInstance | null, info: string) => {
            const errorToReport = convertToError(currentError);

            props.beforeEvaluate?.({ error: errorToReport, instance, info });

            const hierarchy = buildComponentHierarchy(instance);
            const hierarchyFrames = buildComponentHierarchyFrames(instance);
            const componentName = getComponentName(instance);

            error.value = errorToReport;

            const instanceProps = instance?.$props ? { ...instance.$props } : null;

            const errorOrigin = getErrorOrigin(info);

            const context: FlareVueContext = {
                vue: {
                    info,
                    errorOrigin,
                    componentName,
                    componentProps: instanceProps,
                    componentHierarchy: hierarchy,
                    componentHierarchyFrames: hierarchyFrames,
                },
            };

            const finalContext = props.beforeSubmit?.({ error: errorToReport, instance, info, context }) ?? context;

            componentProps.value = finalContext.vue.componentProps;
            componentHierarchy.value = finalContext.vue.componentHierarchy;
            componentHierarchyFrames.value = finalContext.vue.componentHierarchyFrames;

            flare.report(errorToReport, finalContext, { vue: { instance, info } });

            props.afterSubmit?.({ error: errorToReport, instance, info, context: finalContext });

            // Prevent the error from propagating to app.config.errorHandler (set by flareVue()),
            // so the error is only reported to Flare once when both are used together.
            return false;
        });

        return () => {
            if (error.value !== null) {
                if (slots.fallback) {
                    return slots.fallback({
                        error: error.value,
                        componentProps: componentProps.value,
                        componentHierarchy: componentHierarchy.value,
                        componentHierarchyFrames: componentHierarchyFrames.value,
                        resetErrorBoundary,
                    });
                }

                return null;
            }

            return slots.default?.();
        };
    },
});
