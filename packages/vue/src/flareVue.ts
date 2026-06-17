import { convertToError, type AttributeValue, type Attributes } from '@flareapp/core';
import type { App, ComponentPublicInstance, Plugin } from 'vue';

import { buildComponentHierarchy } from './buildComponentHierarchy';
import { buildComponentHierarchyFrames } from './buildComponentHierarchyFrames';
import { resolveDenylist } from './constants';
import { getComponentName } from './getComponentName';
import { getErrorOrigin } from './getErrorOrigin';
import { getRouteContext } from './getRouteContext';
import { registerVueSdkInfo, tagVueFramework } from './identify';
import { resolveFlare } from './resolveFlare';
import { serializeProps } from './serializeProps';
import { FlareVueContext, FlareVueOptions, FlareVueWarningContext } from './types';

export function vueContextToAttributes(context: FlareVueContext): Attributes {
    const vue: Record<string, AttributeValue> = {
        info: context.vue.info,
        errorOrigin: context.vue.errorOrigin,
        componentName: context.vue.componentName,
        componentHierarchy: context.vue.componentHierarchy,
        componentHierarchyFrames: context.vue.componentHierarchyFrames as AttributeValue,
    };

    if (context.vue.componentProps) {
        vue.componentProps = context.vue.componentProps as AttributeValue;
    }
    if (context.vue.route) {
        vue.route = context.vue.route as AttributeValue;
    }

    return { 'context.custom': { vue } };
}

export function vueWarningContextToAttributes(context: FlareVueWarningContext): Attributes {
    const vue: Record<string, AttributeValue> = {
        type: context.vue.type,
        info: context.vue.info,
        componentName: context.vue.componentName,
        componentTrace: context.vue.componentTrace,
    };

    if (context.vue.route) {
        vue.route = context.vue.route as AttributeValue;
    }

    return { 'context.custom': { vue } };
}

// Tracks installed apps so calling app.use(flareVue) twice on the same app is a no-op. WeakSet so
// we don't keep apps alive in memory after they're disposed (notably matters for SSR test harnesses
// that spin up an app per request).
const installedApps = new WeakSet<App>();

export const flareVue: Plugin<[FlareVueOptions?]> = (app: App, options?: FlareVueOptions): void => {
    if (installedApps.has(app)) {
        return;
    }

    // Resolve BEFORE marking the app installed, so a throw (an /inject consumer that forgot the
    // `flare` option) doesn't leave the app recorded in installedApps. NOTE: this only enables a
    // retry when the plugin is invoked DIRECTLY (`flareVue(app, opts)`). Via the public
    // `app.use(flareVue)` API a retry is blocked regardless — Vue adds the plugin to its own
    // installed-set BEFORE calling install, so a failed `app.use` cannot be re-applied to the same
    // app. The ordering here is still correct/defensive; it just isn't reachable through `app.use`.
    const flare = resolveFlare(options?.flare);

    installedApps.add(app);

    // Web default (no injected instance): set the SDK identity on the singleton, as before.
    // Injected instance: tag framework only — never setSdkInfo (would clobber @flareapp/electron).
    if (!options?.flare) {
        registerVueSdkInfo(flare);
    }
    tagVueFramework(flare, app.version);

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

        flare.reportSilently(errorToReport, vueContextToAttributes(finalContext));

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
                () => {},
            );

            if (typeof initialWarnHandler === 'function') {
                initialWarnHandler(msg, instance, trace);
            }
        };
    }
};
