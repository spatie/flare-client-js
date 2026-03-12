import { flare } from '@flareapp/js';
import type { App, ComponentPublicInstance, Plugin } from 'vue';

import { buildComponentHierarchy } from './buildComponentHierarchy';
import { convertToError } from './convertToError';
import { getComponentName } from './getComponentName';
import { FlareVueContext } from './types';

export const flareVue: Plugin = (app: App): void => {
    const initialErrorHandler = app.config.errorHandler;

    app.config.errorHandler = (error: unknown, instance: ComponentPublicInstance | null, info: string) => {
        const errorToReport = convertToError(error);
        const componentName = getComponentName(instance);
        const componentHierarchy = buildComponentHierarchy(instance);

        const context: FlareVueContext = {
            vue: { info, componentName, componentHierarchy },
        };

        flare.report(errorToReport, context, { vue: { instance, info } });

        if (typeof initialErrorHandler === 'function') {
            initialErrorHandler(error, instance, info);

            return;
        }

        throw errorToReport;
    };
};
