import { flare } from '@flareapp/js';
import type { ComponentPublicInstance, PropType } from 'vue';
import { defineComponent, onErrorCaptured, ref } from 'vue';

import { buildComponentHierarchy } from './buildComponentHierarchy';
import { convertToError } from './convertToError';
import { getComponentName } from './getComponentName';
import { FlareErrorBoundaryHookParams, FlareVueContext } from './types';

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
    },

    setup(props, { slots }) {
        const error = ref<Error | null>(null);
        const componentHierarchy = ref<string[]>([]);

        const resetErrorBoundary = () => {
            error.value = null;
            componentHierarchy.value = [];
        };

        onErrorCaptured((currentError: unknown, instance: ComponentPublicInstance | null, info: string) => {
            const errorToReport = convertToError(currentError);

            props.beforeEvaluate?.({ error: errorToReport, instance, info });

            const hierarchy = buildComponentHierarchy(instance);
            const componentName = getComponentName(instance);

            error.value = errorToReport;

            const context: FlareVueContext = {
                vue: {
                    info,
                    componentName,
                    componentHierarchy: hierarchy,
                },
            };

            const finalContext = props.beforeSubmit?.({ error: errorToReport, instance, info, context }) ?? context;

            componentHierarchy.value = finalContext.vue.componentHierarchy;

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
                        componentHierarchy: componentHierarchy.value,
                        resetErrorBoundary,
                    });
                }

                return null;
            }

            return slots.default?.();
        };
    },
});
