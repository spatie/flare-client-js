import { flare } from '@flareapp/js';
import type { App, ComponentPublicInstance, Plugin } from 'vue';

import { buildComponentHierarchy } from './buildComponentHierarchy';
import { buildComponentHierarchyFrames } from './buildComponentHierarchyFrames';
import { convertToError } from './convertToError';
import { getComponentName } from './getComponentName';
import { getErrorOrigin } from './getErrorOrigin';
import { getRouteContext } from './getRouteContext';
import { serializeProps } from './serializeProps';
import { FlareVueContext, FlareVueOptions, FlareVueWarningContext } from './types';

export const flareVue: Plugin<[FlareVueOptions?]> = (app: App, options?: FlareVueOptions): void => {
    const attachProps = options?.attachProps ?? false;
    const propsMaxDepth = options?.propsMaxDepth ?? 2;
    const propsDenylist = options?.propsDenylist;

    const initialErrorHandler = app.config.errorHandler;

    app.config.errorHandler = (error: unknown, instance: ComponentPublicInstance | null, info: string) => {
        const errorToReport = convertToError(error);

        options?.beforeEvaluate?.({ error: errorToReport, instance, info });

        const errorOrigin = getErrorOrigin(info);
        const componentName = getComponentName(instance);
        const componentProps =
            attachProps && instance?.$props ? serializeProps(instance.$props, propsMaxDepth, propsDenylist) : undefined;
        const componentHierarchy = buildComponentHierarchy(instance);
        const componentHierarchyFrames = buildComponentHierarchyFrames(instance, {
            attachProps,
            propsMaxDepth,
            propsDenylist,
        });

        const route = getRouteContext(app.config.globalProperties.$router);

        const context: FlareVueContext = {
            vue: {
                info,
                errorOrigin,
                componentName,
                ...(componentProps && { componentProps }),
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

            const context: FlareVueWarningContext = {
                vue: {
                    type: 'warning',
                    info: msg,
                    componentName,
                    componentTrace: trace,
                    ...(route && { route }),
                },
            };

            flare.reportMessage(msg, context, 'VueWarning');

            if (typeof initialWarnHandler === 'function') {
                initialWarnHandler(msg, instance, trace);
            }
        };
    }
};
