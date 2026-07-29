import { Api, Flare as CoreFlare, FrameworkName, GlobalScopeProvider, NullFileReader } from '@flareapp/core';
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

/** How long a fatal JS crash holds the app open to drain the transport before RN's default handler runs. */
const FATAL_FLUSH_TIMEOUT_MS = 2000;

/**
 * The RN `Flare` singleton, exposed as `flare` from the package root. Uses `NullFileReader` because there
 * are no runtime snippets on a device (sourcemaps are a Metro follow-up) and `GlobalScopeProvider` because
 * RN has a single app scope.
 */
export class ReactNativeFlare extends CoreFlare {
    private readonly scheduler: ReactNativeFlushScheduler;
    private readonly rejectionDeps: RejectionDeps;
    private installed = false;
    private uninstallers: Array<() => void> = [];

    /**
     * @param rejectionDeps test seam. Default `{}` resolves the active engine's tracker (Hermes or JSC);
     *        tests pass `{ enable: null }` so `light()` installs no leaking global tracker.
     */
    constructor(rejectionDeps: RejectionDeps = {}) {
        const scheduler = new ReactNativeFlushScheduler();
        const collector = makeReactNativeContextCollector();
        super(new Api(), collector, new NullFileReader(), new GlobalScopeProvider(), scheduler);
        this.scheduler = scheduler;
        this.rejectionDeps = rejectionDeps;
        this.setSdkInfo({ name: RN_SDK_NAME, version: RN_SDK_VERSION });
        // Tag the framework identity proactively so it holds even when no
        // FlareErrorBoundary is mounted to tag it (see setFramework below).
        this.setFramework({ name: FrameworkName.ReactNative });
    }

    /**
     * The wrapped `@flareapp/react` boundary tags every flare it injects as `react`, which is wrong here,
     * so coerce the name while keeping whatever version the caller supplied.
     */
    setFramework(framework: Framework): this {
        return super.setFramework({ ...framework, name: FrameworkName.ReactNative });
    }

    /** Idempotent: a second `light()` must not double-wrap `ErrorUtils`, which node's reconcile gets for free. */
    light(key?: string, debug?: boolean): this {
        super.light(key, debug);
        this.install();
        return this;
    }

    /** For tests and manual teardown. Clears the install guard, so a later `light()` re-installs. */
    removeHandlers(): void {
        // Each one is guarded on its own: a teardown that throws must not leave the rest attached, nor
        // leave the install guard set, which would block a re-install.
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
        if (this.installed) {
            return;
        }
        this.installed = true;
        this.uninstallers.push(
            // `reportSilently`, not `report`: it swallows its own transport rejection, so a reporting
            // failure cannot raise a second error from inside the global handler.
            installGlobalErrorHandler(
                (error, isFatal) => {
                    this.reportSilently(error, { 'error.fatal': isFatal });
                },
                () => this.flush(FATAL_FLUSH_TIMEOUT_MS),
            ),
            installRejectionTracking(
                {
                    reportSilently: (error) => this.reportSilently(error),
                    // Returns the promise (no `void`) so `routeRejection` owns the `.catch`, as in @flareapp/js.
                    reportUnhandledRejection: (message) => this.reportUnhandledRejection(message),
                },
                this.rejectionDeps,
            ),
            installAppStateFlush(() => this.scheduler.getFlush()),
        );
    }
}
