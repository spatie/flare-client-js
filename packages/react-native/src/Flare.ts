import { Api, Flare as CoreFlare, GlobalScopeProvider, NullFileReader } from '@flareapp/core';

import { makeReactNativeContextCollector } from './context/collectReactNative';
import { installAppStateFlush } from './handlers/appStateFlush';
import { installGlobalErrorHandler } from './handlers/globalErrorHandler';
import { installRejectionTracking } from './handlers/rejectionTracking';
import type { RejectionDeps } from './handlers/rejectionTracking';
import { ReactNativeFlushScheduler } from './ReactNativeFlushScheduler';
import type { User } from './types';

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
 * Adds RN-only surface: `setUser`, `removeHandlers`, and an idempotent handler
 * install folded into `light()`.
 */
export class ReactNativeFlare extends CoreFlare {
    private user: User | null = null;
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
        // `() => this.user` reads lazily at report time; `this` is not accessed
        // during construction, so referencing it before `super(...)` is safe —
        // the same deferral node's collector relies on.
        const collector = makeReactNativeContextCollector(() => this.user);
        super(new Api(), collector, new NullFileReader(), new GlobalScopeProvider(), scheduler);
        this.scheduler = scheduler;
        this.rejectionDeps = rejectionDeps;
        this.setSdkInfo({ name: RN_SDK_NAME, version: RN_SDK_VERSION });
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

    /** Attach the authenticated user; read by the collector at report time. */
    setUser(user: User | null): void {
        this.user = user;
    }

    /**
     * Detach the global error handler, rejection tracker, and AppState listener,
     * and clear the install guard so a later `light()` re-installs. For tests
     * and manual teardown (mirrors node's `removeProcessListeners`).
     */
    removeHandlers(): void {
        this.uninstallers.forEach((uninstall) => uninstall());
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
            // attribute so a fatal JS crash is distinguishable in Flare.
            installGlobalErrorHandler((error, isFatal) => {
                this.reportSilently(error, { 'error.fatal': isFatal });
            }),
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
