import { type Attributes, flare } from '@flareapp/js';
import type { App, ComponentPublicInstance, Plugin } from 'vue';

import { buildComponentHierarchy } from './buildComponentHierarchy';
import { buildComponentHierarchyFrames } from './buildComponentHierarchyFrames';
import { DEFAULT_PROPS_DENYLIST, PACKAGE_VERSION, resolveDenylist } from './constants';
import { convertToError } from './convertToError';
import { getComponentName } from './getComponentName';
import { getErrorOrigin } from './getErrorOrigin';
import { getRouteContext, redactFullPath } from './getRouteContext';
import { serializeProps } from './serializeProps';
import { FlareVueContext, FlareVueOptions, FlareVueWarningContext } from './types';

export function vueContextToAttributes(context: FlareVueContext): Attributes {
    return { 'context.custom': { vue: context.vue as never } };
}

export function vueWarningContextToAttributes(context: FlareVueWarningContext): Attributes {
    return { 'context.custom': { vue: context.vue as never } };
}

export function urlAttributesWithScrubbedQuery(denylist: RegExp = DEFAULT_PROPS_DENYLIST): Attributes {
    if (typeof window === 'undefined' || !window.location) {
        return {};
    }
    const href = window.location.href;
    const search = window.location.search;
    const attrs: Attributes = { 'url.full': redactFullPath(href, denylist) };
    if (search) {
        attrs['url.query'] = redactFullPath(search, denylist).replace(/^\?/, '');
    }
    return attrs;
}

const installedApps = new WeakSet<App>();

export const flareVue: Plugin<[FlareVueOptions?]> = (app: App, options?: FlareVueOptions): void => {
    if (installedApps.has(app)) {
        return;
    }
    installedApps.add(app);

    flare.setSdkInfo({ name: '@flareapp/vue', version: PACKAGE_VERSION });
    flare.setFramework({ name: 'Vue', version: app.version });

    const attachProps = options?.attachProps ?? false;
    const propsMaxDepth = options?.propsMaxDepth ?? 2;
    const propsDenylist = resolveDenylist(options?.propsDenylist, options?.replaceDefaultDenylist);

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

        const route = getRouteContext(app.config.globalProperties.$router, { denylist: propsDenylist });

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

        const attributes: Attributes = {
            ...urlAttributesWithScrubbedQuery(propsDenylist ?? DEFAULT_PROPS_DENYLIST),
            ...vueContextToAttributes(finalContext),
        };

        Promise.resolve(flare.report(errorToReport, attributes)).catch(() => {});

        options?.afterSubmit?.({ error: errorToReport, instance, info, context: finalContext });

        if (typeof initialErrorHandler === 'function') {
            initialErrorHandler(error, instance, info);

            return;
        }

        throw error;
    };

    if (options?.captureWarnings) {
        const initialWarnHandler = app.config.warnHandler;

        app.config.warnHandler = (msg: string, instance: ComponentPublicInstance | null, trace: string) => {
            const componentName = getComponentName(instance);
            const route = getRouteContext(app.config.globalProperties.$router, { denylist: propsDenylist });

            const context: FlareVueWarningContext = {
                vue: {
                    type: 'warning',
                    info: msg,
                    componentName,
                    componentTrace: trace,
                    ...(route && { route }),
                },
            };

            const warnAttributes: Attributes = {
                ...urlAttributesWithScrubbedQuery(propsDenylist ?? DEFAULT_PROPS_DENYLIST),
                ...vueWarningContextToAttributes(context),
            };

            Promise.resolve(flare.reportMessage(msg, 'warning', warnAttributes)).catch(() => {});

            if (typeof initialWarnHandler === 'function') {
                initialWarnHandler(msg, instance, trace);
            }
        };
    }
};
