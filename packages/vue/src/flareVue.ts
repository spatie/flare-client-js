import { type Attributes, flare } from '@flareapp/js';
import type { App, ComponentPublicInstance, Plugin } from 'vue';

import { buildComponentHierarchy } from './buildComponentHierarchy';
import { buildComponentHierarchyFrames } from './buildComponentHierarchyFrames';
import { PACKAGE_VERSION, resolveDenylist } from './constants';
import { convertToError } from './convertToError';
import { getComponentName } from './getComponentName';
import { getErrorOrigin } from './getErrorOrigin';
import { getRouteContext } from './getRouteContext';
import { serializeProps } from './serializeProps';
import { FlareVueContext, FlareVueOptions, FlareVueWarningContext } from './types';

export function vueContextToAttributes(context: FlareVueContext): Attributes {
    return { 'context.custom': { framework: 'vue', vue: context.vue as never } };
}

export function vueWarningContextToAttributes(context: FlareVueWarningContext): Attributes {
    return { 'context.custom': { framework: 'vue', vue: context.vue as never } };
}

// Tracks installed apps so calling app.use(flareVue) twice on the same app is a no-op. WeakSet so
// we don't keep apps alive in memory after they're disposed (notably matters for SSR test harnesses
// that spin up an app per request).
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

    // Capture any errorHandler the app already set so we can chain it. If we replaced it blindly we'd
    // silently disable user-defined handlers (e.g. one provided by a higher-level framework like Nuxt).
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

        // Swallow rejection: a transport failure must not interfere with the user's errorHandler
        // chain or Vue's render pipeline.
        Promise.resolve(flare.report(errorToReport, vueContextToAttributes(finalContext))).catch(() => {});

        options?.afterSubmit?.({ error: errorToReport, instance, info, context: finalContext });

        if (typeof initialErrorHandler === 'function') {
            initialErrorHandler(error, instance, info);

            return;
        }

        // No prior handler: log so the error is visible during development without re-throwing.
        // Re-throwing would trigger window.onerror and produce a duplicate report (one with Vue
        // context from this handler, one without from the global catchWindowErrors listener).
        console.error(error);
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

            Promise.resolve(flare.reportMessage(msg, 'warning', vueWarningContextToAttributes(context))).catch(
                () => {}
            );

            if (typeof initialWarnHandler === 'function') {
                initialWarnHandler(msg, instance, trace);
            }
        };
    }
};
