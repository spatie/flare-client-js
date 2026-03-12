import { flare } from '@flareapp/js';
import type { ComponentPublicInstance } from 'vue';
import { defineComponent, onErrorCaptured, ref } from 'vue';

import { buildComponentHierarchy } from './componentHierarchy';
import { convertToError } from './convertToError';
import { getComponentName } from './getComponentName';
import { FlareVueContext } from './types';

export const FlareErrorBoundary = defineComponent({
    name: 'FlareErrorBoundary',

    setup(_, { slots }) {
        const error = ref<Error | null>(null);
        const componentHierarchy = ref<string[]>([]);

        const resetErrorBoundary = () => {
            error.value = null;
            componentHierarchy.value = [];
        };

        onErrorCaptured((currentError: unknown, instance: ComponentPublicInstance | null, info: string) => {
            const errorToReport = convertToError(currentError);
            const hierarchy = buildComponentHierarchy(instance);
            const componentName = getComponentName(instance);

            error.value = errorToReport;
            componentHierarchy.value = hierarchy;

            const context: FlareVueContext = {
                vue: {
                    info,
                    componentName,
                    componentHierarchy: hierarchy,
                },
            };

            flare.report(errorToReport, context, { vue: { instance, info } });

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
