import { Api, Flare as CoreFlare, GlobalScopeProvider, NullFileReader } from '@flareapp/core';
import type { Framework } from '@flareapp/core';

import { makeReactNativeContextCollector } from './context/collectReactNative';
import { installAppStateFlush } from './handlers/appStateFlush';
import { installGlobalErrorHandler } from './handlers/globalErrorHandler';
import { installRejectionTracking } from './handlers/rejectionTracking';
import type { RejectionDeps } from './handlers/rejectionTracking';
import { ReactNativeFlushScheduler } from './ReactNativeFlushScheduler';

// `process.env.FLARE_JS_CLIENT_VERSION` is inlined at build time by tsdown's `--env` define. Keep it a
// PLAIN member access: a `typeof process` guard (like node's) would defeat the inline, since RN has no
// runtime `process`. Do NOT add a local `declare const process`; it shadows the global and stops the
// define from matching, so the version never inlines. Under vitest (real node) it reads '?', fine for tests.
const RN_SDK_NAME = '@flareapp/react-native';
const RN_SDK_VERSION: string = (process.env.FLARE_JS_CLIENT_VERSION as string | undefined) ?? '?';
const RN_FRAMEWORK_NAME = 'React Native';

/** How long a fatal JS crash holds the app open to drain the transport before delegating to RN's default handler (see globalErrorHandler). */
const FATAL_FLUSH_TIMEOUT_MS = 2000;

/**
 * React Native `Flare` singleton (exposed as `flare` from the package root).
 *
 * Subclasses core's `Flare`, injecting the RN seams: core `Api` (native fetch), the RN context collector,
 * core `NullFileReader` (no runtime snippets; sourcemaps are a Metro follow-up), core `GlobalScopeProvider`
 * (RN is a single app scope), and `ReactNativeFlushScheduler` (best-effort flush on background).
 *
 * Adds RN-only surface: `removeHandlers` and an idempotent handler install folded into `light()`. `setUser`
 * is inherited from core, writing the backend-read `user.*` keys to the single global scope.
 */
export class ReactNativeFlare extends CoreFlare {
    private readonly scheduler: ReactNativeFlushScheduler;
    private readonly rejectionDeps: RejectionDeps;
    private installed = false;
    private uninstallers: Array<() => void> = [];

    /**
     * @param rejectionDeps test seam for the rejection hook. Default `{}` resolves the active engine's
     *        tracker (Hermes or JSC). Tests pass `{ enable: null }` so `light()` installs no leaking global tracker.
     */
    constructor(rejectionDeps: RejectionDeps = {}) {
        const scheduler = new ReactNativeFlushScheduler();
        const collector = makeReactNativeContextCollector();
        super(new Api(), collector, new NullFileReader(), new GlobalScopeProvider(), scheduler);
        this.scheduler = scheduler;
        this.rejectionDeps = rejectionDeps;
        this.setSdkInfo({ name: RN_SDK_NAME, version: RN_SDK_VERSION });
        // Tag framework identity up front so it holds even without a FlareErrorBoundary to tag it.
        this.setFramework({ name: RN_FRAMEWORK_NAME });
    }

    /**
     * Force the framework name to "React Native", preserving the caller's version. The wrapped
     * `@flareapp/react` boundary tags injected flares as `React` (via `tagReactFramework`), wrong here.
     */
    setFramework(framework: Framework): this {
        return super.setFramework({ ...framework, name: RN_FRAMEWORK_NAME });
    }

    /**
     * Set the API key (and optional debug flag), then install the global handlers. Idempotent: calling
     * `light()` twice does not double-wrap `ErrorUtils` (which, unlike node's reconcile, is not naturally so).
     */
    light(key?: string, debug?: boolean): this {
        super.light(key, debug);
        this.install();
        return this;
    }

    /**
     * Detach the global error handler, rejection tracker, and AppState listener, and clear the install
     * guard so a later `light()` re-installs. For tests and manual teardown (mirrors node's `removeProcessListeners`).
     */
    removeHandlers(): void {
        // Guard each uninstaller individually so one throwing teardown does not strand the rest attached
        // or leave the install guard set, which would block re-install.
        for (const uninstall of this.uninstallers) {
            try {
                uninstall();
            } catch {
                // Best-effort teardown.
            }
        }
        this.uninstallers = [];
        this.installed = false;
    }

    private install(): void {
        if (this.installed) return;
        this.installed = true;
        this.uninstallers.push(
            // `reportSilently` (not `report`) swallows its own transport rejection so a reporting failure
            // can't trigger a second error inside the global handler. `isFatal` rides as an attribute.
            // `onFatal` drains the transport before a production fatal crash tears the app down (see globalErrorHandler).
            installGlobalErrorHandler(
                (error, isFatal) => {
                    this.reportSilently(error, { 'error.fatal': isFatal });
                },
                () => this.flush(FATAL_FLUSH_TIMEOUT_MS),
            ),
            // Mirrors the browser unhandledrejection path: stack-bearing reasons keep their stack via
            // reportSilently, stackless reasons fall back to reportUnhandledRejection.
            installRejectionTracking(
                {
                    reportSilently: (error) => this.reportSilently(error),
                    // Return the promise (no `void`) so `routeRejection` owns the `.catch`, matching @flareapp/js.
                    reportUnhandledRejection: (message) => this.reportUnhandledRejection(message),
                },
                this.rejectionDeps,
            ),
            installAppStateFlush(() => this.scheduler.getFlush()),
        );
    }
}
