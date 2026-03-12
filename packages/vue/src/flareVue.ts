import { flare } from '@flareapp/js';
import type { App, ComponentPublicInstance, Plugin } from 'vue';

import { buildComponentHierarchy } from './buildComponentHierarchy';
import { buildComponentHierarchyFrames } from './buildComponentHierarchyFrames';
import { convertToError } from './convertToError';
import { getComponentName } from './getComponentName';
import { getErrorOrigin } from './getErrorOrigin';
import { getRouteContext } from './getRouteContext';
import { FlareVueContext, FlareVueOptions } from './types';

export const flareVue: Plugin<[FlareVueOptions?]> = (app: App, options?: FlareVueOptions): void => {
    const initialErrorHandler = app.config.errorHandler;

    app.config.errorHandler = (error: unknown, instance: ComponentPublicInstance | null, info: string) => {
        const errorToReport = convertToError(error);

        options?.beforeEvaluate?.({ error: errorToReport, instance, info });

        const errorOrigin = getErrorOrigin(info);
        const componentName = getComponentName(instance);
        const componentProps = instance?.$props ? { ...instance.$props } : null;
        const componentHierarchy = buildComponentHierarchy(instance);
        const componentHierarchyFrames = buildComponentHierarchyFrames(instance);

        const route = getRouteContext(app.config.globalProperties.$router);

        const context: FlareVueContext = {
            vue: {
                info,
                errorOrigin,
                componentName,
                componentProps,
                componentHierarchy,
                componentHierarchyFrames,
                ...(route && { route }),
            },
        };

        const finalContext = options?.beforeSubmit?.({ error: errorToReport, instance, info, context }) ?? context;

        flare.report(errorToReport, finalContext, { vue: { instance, info } });

        options?.afterSubmit?.({ error: errorToReport, instance, info, context: finalContext });

        if (typeof initialErrorHandler === 'function') {
            initialErrorHandler(error, instance, info);

            return;
        }

        throw errorToReport;
    };

    if (options?.captureWarnings) {
        const initialWarnHandler = app.config.warnHandler;

        app.config.warnHandler = (msg: string, instance: ComponentPublicInstance | null, trace: string) => {
            const componentName = getComponentName(instance);
            const route = getRouteContext(app.config.globalProperties.$router);

            flare.reportMessage(
                msg,
                { vue: { message: msg, componentName, trace, ...(route && { route }) } },
                'VueWarning'
            );

            if (typeof initialWarnHandler === 'function') {
                initialWarnHandler(msg, instance, trace);
            }
        };
    }
};
