import { Api, Flare as CoreFlare, GlobalScopeProvider, NullFileReader } from '@flareapp/core';
import type { Framework } from '@flareapp/core';

import { makeReactNativeContextCollector } from './context/collectReactNative';
import { installAppStateFlush } from './handlers/appStateFlush';
import { installGlobalErrorHandler } from './handlers/globalErrorHandler';
import { installRejectionTracking } from './handlers/rejectionTracking';
import type { RejectionDeps } from './handlers/rejectionTracking';
import { ReactNativeFlushScheduler } from './ReactNativeFlushScheduler';

// `process.env.FLARE_JS_CLIENT_VERSION` is replaced at BUILD time by tsdown's
// `--env` define, becoming a string literal in the output. It must be a PLAIN
// member access (no optional chaining, no `typeof process` guard) — unlike
// node's version, which guards on `process` existing. RN has no `process` at
// runtime, so node's guard would defeat the inlined literal and fall back to
// '?'. After the define replacement no `process` reference survives. In the
// vitest source path (real node) it reads undefined and falls back to '?',
// which is fine for tests.
//
// Do NOT add a local `declare const process` here: a local declaration shadows
// the global identifier and stops rolldown's `--env` define from matching the
// member access, so the version would never inline. The global `process` type
// comes from the toolchain (@types/node), which keeps tsc happy.
const RN_SDK_NAME = '@flareapp/react-native';
const RN_SDK_VERSION: string = (process.env.FLARE_JS_CLIENT_VERSION as string | undefined) ?? '?';
const RN_FRAMEWORK_NAME = 'React Native';

// How long a fatal JS crash holds the app open to drain the transport before
// delegating to RN's crash-triggering default handler (see globalErrorHandler).
const FATAL_FLUSH_TIMEOUT_MS = 2000;

/**
 * React Native `Flare` singleton (exposed as `flare` from the package root).
 *
 * Subclasses core's `Flare`, injecting the RN seams:
 * - core `Api` (fetch is native in RN),
 * - `makeReactNativeContextCollector(() => this.user)` for device/app/user attrs,
 * - core `NullFileReader` (no runtime source snippets; sourcemaps are a Metro
 *   follow-up),
 * - core `GlobalScopeProvider` (RN is a single app scope),
 * - `ReactNativeFlushScheduler` (flush on background, best-effort).
 *
 * Adds RN-only surface: `removeHandlers` and an idempotent handler install folded
 * into `light()`. `setUser` is inherited from core, which writes the backend-read
 * `user.*` identity keys to the active scope (RN uses the single global scope).
 */
export class ReactNativeFlare extends CoreFlare {
    private readonly scheduler: ReactNativeFlushScheduler;
    private readonly rejectionDeps: RejectionDeps;
    private installed = false;
    private uninstallers: Array<() => void> = [];

    /**
     * @param rejectionDeps test seam for the rejection hook. Defaults to `{}`
     *        (resolve the active engine's tracker — Hermes or JSC). Tests pass
     *        `{ enable: null }` so `light()` does NOT enable a global rejection
     *        tracker as a leaking side effect.
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
        this.setFramework({ name: RN_FRAMEWORK_NAME });
    }

    /**
     * Force the framework identity to "React Native". The wrapped
     * `@flareapp/react` boundary tags every flare it injects as `React` (via
     * `tagReactFramework`), which is wrong on the RN singleton — so coerce the
     * name here while preserving whatever version the caller supplied (the React
     * renderer version when the boundary tags it).
     */
    setFramework(framework: Framework): this {
        return super.setFramework({ ...framework, name: RN_FRAMEWORK_NAME });
    }

    /**
     * Set the API key (and optional debug flag), then install the global
     * handlers. The install is idempotent — calling `light()` twice does NOT
     * double-wrap `ErrorUtils` (which, unlike node's reconcile, is not naturally
     * idempotent).
     */
    light(key?: string, debug?: boolean): this {
        super.light(key, debug);
        this.install();
        return this;
    }

    /**
     * Detach the global error handler, rejection tracker, and AppState listener,
     * and clear the install guard so a later `light()` re-installs. For tests
     * and manual teardown (mirrors node's `removeProcessListeners`).
     */
    removeHandlers(): void {
        // Guard each uninstaller individually: one throwing teardown (e.g. a
        // malformed AppState subscription) must not strand the remaining handlers
        // attached or leave the install guard set, which would block re-install.
        for (const uninstall of this.uninstallers) {
            try {
                uninstall();
            } catch {
                // Best-effort teardown; nothing actionable if an uninstaller throws.
            }
        }
        this.uninstallers = [];
        this.installed = false;
    }

    private install(): void {
        if (this.installed) return;
        this.installed = true;
        this.uninstallers.push(
            // `reportSilently` (not `report`) is deliberate: it swallows its own
            // transport rejection so a reporting failure can't trigger a second
            // error inside the global handler. `isFatal` is attached as an
            // attribute so a fatal JS crash is distinguishable in Flare. The
            // `onFatal` hook drains the transport before the app is torn down on a
            // production fatal crash (best-effort; see globalErrorHandler).
            installGlobalErrorHandler(
                (error, isFatal) => {
                    this.reportSilently(error, { 'error.fatal': isFatal });
                },
                () => this.flush(FATAL_FLUSH_TIMEOUT_MS),
            ),
            // Reporter mirrors the browser unhandledrejection path: Error /
            // stack-bearing reasons keep their stack via reportSilently; only
            // stackless reasons fall back to reportUnhandledRejection.
            installRejectionTracking(
                {
                    reportSilently: (error) => this.reportSilently(error),
                    reportUnhandledRejection: (message) => void this.reportUnhandledRejection(message),
                },
                this.rejectionDeps,
            ),
            installAppStateFlush(() => this.scheduler.getFlush()),
        );
    }
}
