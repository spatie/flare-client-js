import { convertToError, toCustomContext, type AttributeValue, type Attributes } from '@flareapp/core';
import type { App, ComponentPublicInstance, Plugin } from 'vue';

import { buildComponentHierarchy } from './buildComponentHierarchy';
import { buildComponentHierarchyFrames } from './buildComponentHierarchyFrames';
import { resolveDenylist } from './constants';
import { getComponentName } from './getComponentName';
import { getErrorOrigin } from './getErrorOrigin';
import { getRouteContext } from './getRouteContext';
import { registerVueSdkInfo, tagVueFramework } from './identify';
import { createComponentMatcher, createComponentProfilerMixin } from './profileVueComponents';
import { resolveFlare } from './resolveFlare';
import { serializeProps } from './serializeProps';
import { traceVueRouter } from './traceVueRouter';
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

    return toCustomContext('vue', vue);
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

    return toCustomContext('vue', vue);
}

// Tracks installed apps so app.use(flareVue) twice is a no-op. WeakSet avoids keeping disposed
// apps alive, which matters for SSR where each request creates a new app.
const installedApps = new WeakSet<App>();

export const flareVue: Plugin<[FlareVueOptions?]> = (app: App, options?: FlareVueOptions): void => {
    if (installedApps.has(app)) {
        return;
    }

    // Resolve before marking installed, so a throw doesn't leave a half-installed app in installedApps.
    // Only matters for a direct flareVue(app, opts) call; app.use() already blocks retries via Vue's
    // own installed-plugin set.
    const flare = resolveFlare(options?.flare);

    installedApps.add(app);

    // Web default (no injected instance): set SDK identity on the singleton. Injected instance: only
    // tag the framework, never setSdkInfo — that would clobber @flareapp/electron.
    if (!options?.flare) {
        registerVueSdkInfo(flare);
    }
    tagVueFramework(flare, app.version);

    const attachProps = options?.attachProps ?? false;
    const propsMaxDepth = options?.propsMaxDepth ?? 2;
    const propsDenylist = resolveDenylist(options?.propsDenylist, options?.replaceDefaultDenylist);

    // Capture any errorHandler the app already set so we can chain it; replacing it blindly would
    // silently disable user-defined handlers (e.g. one from a higher-level framework like Nuxt).
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

        // No prior handler: log instead of re-throwing, so the error stays visible without
        // triggering window.onerror and creating a duplicate report.
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

    // Wired unconditionally: `flare.configure({ enableTracing: true })` can be called after
    // app.use(flareVue), and browser.ts starts tracing from that call. Gating here would make
    // plugin order matter, unlike the other integrations.
    if (options?.router) {
        try {
            const stopRouterTracing = traceVueRouter(options.router);
            // app.onUnmount exists from Vue 3.5 on; the declared peer floor is ^3.0.0. Without it, an
            // SSR app-per-request setup leaves old router guards attached with no way to remove them.
            if (typeof app.onUnmount === 'function') {
                app.onUnmount(stopRouterTracing);
            }
        } catch {
            // never break plugin install
        }
    }

    // An empty allowlist counts as off, not just "an array was passed". Not gated on tracing being
    // on: configure() can enable it later, and the hook is a no-op with no root to record under.
    const profile = options?.profileComponents;
    const wantsProfiling = profile === true || (Array.isArray(profile) && profile.length > 0);

    if (!wantsProfiling) {
        return;
    }

    try {
        app.mixin(createComponentProfilerMixin(createComponentMatcher(profile)));
    } catch {
        // never break plugin install
    }
};
