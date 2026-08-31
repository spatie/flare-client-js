import { Api, Flare as CoreFlare, FrameworkName, GlobalScopeProvider, NullFileReader } from '@flareapp/core';
import type { Framework } from '@flareapp/core';

import { makeReactNativeContextCollector } from './context/collectReactNative';
import { installAppStateFlush } from './handlers/appStateFlush';
import { installGlobalErrorHandler } from './handlers/globalErrorHandler';
import { installRejectionTracking } from './handlers/rejectionTracking';
import type { RejectionDeps } from './handlers/rejectionTracking';
import { ReactNativeFlushScheduler } from './ReactNativeFlushScheduler';

// tsdown inlines `process.env.FLARE_JS_CLIENT_VERSION` at build time via a plain member access. Don't
// guard it with `typeof process` or declare a local `process` — either breaks the inline since RN has no
// runtime `process`. Under vitest it just reads '?'.
const RN_SDK_NAME = '@flareapp/react-native';
const RN_SDK_VERSION: string = (process.env.FLARE_JS_CLIENT_VERSION as string | undefined) ?? '?';

// How long a fatal JS crash holds the app open to drain the transport before RN's default handler runs.
const FATAL_FLUSH_TIMEOUT_MS = 2000;

/**
 * The RN `Flare` singleton, exposed as `flare`. Uses `NullFileReader` (no runtime snippets on device) and
 * `GlobalScopeProvider` (RN has a single app scope).
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
        // Tag framework identity now so it's set even without a mounted FlareErrorBoundary (see setFramework below).
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
        // Guard each teardown separately: one throwing must not skip the rest or block a re-install.
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
            // `reportSilently`, not `report`: swallows its own rejection so it can't raise a second error here.
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
