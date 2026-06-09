import { Api, Flare as CoreFlare, GlobalScopeProvider, type Config, type Report } from '@flareapp/core';
import type { App, IpcMain } from 'electron';

import { CLIENT_VERSION } from '../env';
import {
    DEFAULT_ELECTRON_OPTIONS,
    type ElectronOptions,
    type ElectronUser,
    type ResolvedElectronOptions,
} from '../types';
import { collectElectronAppAttributes, makeElectronContextCollector, projectUser } from './collectElectron';
import { ElectronDiskFileReader } from './ElectronDiskFileReader';
import { ElectronFlushScheduler } from './ElectronFlushScheduler';
import { disposeIpcReceiver, registerIpcReceiver } from './ipcReceiver';
import { buildFatalCallbacks, ProcessHandlerManager } from './processHandlers';

type AppLike = Pick<App, 'getName' | 'getVersion' | 'getLocale' | 'isReady' | 'exit' | 'on' | 'off'> & {
    isPackaged: boolean;
};

export type ElectronFlareDeps = {
    app: AppLike;
    ipcMain: IpcMain;
};

const SDK_NAME = '@flareapp/electron';

export class ElectronFlare extends CoreFlare {
    private app: AppLike;
    private ipcMain: IpcMain;
    private options: ResolvedElectronOptions = { ...DEFAULT_ELECTRON_OPTIONS };
    private user: ElectronUser | null = null;
    private isLit = false;
    private handlerManager: ProcessHandlerManager;
    private renderGoneHandler: ((...args: any[]) => Promise<void>) | null = null;
    private childGoneHandler: ((...args: any[]) => Promise<void>) | null = null;
    private forwardedInFlight = new Set<Promise<void>>();

    // Captured from configure() because CoreFlare._config is private.
    private mainStage = '';
    private mainVersion = '';
    private mainSourcemapVersionId = '';

    constructor(deps: ElectronFlareDeps) {
        const app = deps.app;
        const scopeProvider = new GlobalScopeProvider();
        // The collector closes over `() => this.user` (a getter, not a value) so later
        // setUser(...) calls are reflected on future reports without reinjecting the collector.
        // Capturing `this` inside a nested arrow before super() is legal TypeScript; only direct
        // `this` access before super() is an error. NodeFlare uses the same pattern.
        const collector = makeElectronContextCollector(app, () => this.user);
        super(new Api(), collector, new ElectronDiskFileReader(), scopeProvider, new ElectronFlushScheduler(app));
        this.app = app;
        this.ipcMain = deps.ipcMain;
        this.setSdkInfo({ name: SDK_NAME, version: CLIENT_VERSION });

        const cbs = buildFatalCallbacks(
            this,
            () => this.options,
            (code) => this.app.exit(code),
        );
        this.handlerManager = new ProcessHandlerManager(cbs);

        // Receive renderer reports immediately; key is not required to register the channel.
        registerIpcReceiver(this.ipcMain, this, {
            getOptions: () => this.options,
            onReport: (report) => this.receiveRendererReport(report),
        });

        // Crash observers (like the IPC receiver) attach immediately: they only observe, and any
        // report they produce drops harmlessly until light() sets a key. The fatal process handlers,
        // by contrast, gate on light() because they alter the process's crash behavior.
        this.reconcileCrashListeners();
    }

    configure(config: Partial<Config>): this {
        if (config.stage !== undefined) this.mainStage = config.stage;
        if (config.version !== undefined) this.mainVersion = config.version;
        if (config.sourcemapVersionId !== undefined) this.mainSourcemapVersionId = config.sourcemapVersionId;
        return super.configure(config);
    }

    light(key?: string, debug?: boolean): this {
        super.light(key, debug);
        this.isLit = true;
        this.handlerManager.reconcile(this.options);
        return this;
    }

    configureElectron(partial: ElectronOptions): this {
        if (partial.uncaughtExceptionMode !== undefined)
            this.options.uncaughtExceptionMode = partial.uncaughtExceptionMode;
        if (partial.unhandledRejectionMode !== undefined)
            this.options.unhandledRejectionMode = partial.unhandledRejectionMode;
        if (partial.shutdownTimeoutMs !== undefined) this.options.shutdownTimeoutMs = partial.shutdownTimeoutMs;
        if (partial.captureRenderProcessGone !== undefined)
            this.options.captureRenderProcessGone = partial.captureRenderProcessGone;
        if (partial.trustedProtocols !== undefined) {
            this.options.trustedProtocols = Array.isArray(partial.trustedProtocols) ? partial.trustedProtocols : [];
        }
        if (partial.trustSender !== undefined) this.options.trustSender = partial.trustSender;
        if (partial.maxReportBytes !== undefined && Number.isFinite(partial.maxReportBytes)) {
            this.options.maxReportBytes = partial.maxReportBytes;
        }
        if (this.isLit) this.handlerManager.reconcile(this.options);
        this.reconcileCrashListeners();
        return this;
    }

    setUser(user: ElectronUser | null): void {
        this.user = user;
    }

    dispose(): void {
        this.handlerManager.detach();
        this.detachCrashListeners();
        disposeIpcReceiver(this.ipcMain, this);
    }

    /** Attach or detach the process-gone listeners to match options.captureRenderProcessGone. Idempotent. */
    private reconcileCrashListeners(): void {
        const want = this.options.captureRenderProcessGone;
        const attached = this.renderGoneHandler !== null;
        if (want && !attached) {
            this.renderGoneHandler = (
                _event: unknown,
                webContents: { id?: number } | undefined,
                details: { reason?: string; exitCode?: number },
            ) => {
                return this.reportProcessGone('renderer', details, webContents?.id);
            };
            this.childGoneHandler = (
                _event: unknown,
                details: { reason?: string; exitCode?: number; type?: string; serviceName?: string },
            ) => {
                return this.reportProcessGone('child', details);
            };
            this.app.on('render-process-gone', this.renderGoneHandler as any);
            this.app.on('child-process-gone', this.childGoneHandler as any);
        } else if (!want && attached) {
            this.detachCrashListeners();
        }
    }

    private detachCrashListeners(): void {
        if (this.renderGoneHandler) {
            this.app.off('render-process-gone', this.renderGoneHandler as any);
            this.renderGoneHandler = null;
        }
        if (this.childGoneHandler) {
            this.app.off('child-process-gone', this.childGoneHandler as any);
            this.childGoneHandler = null;
        }
    }

    private reportProcessGone(
        kind: 'renderer' | 'child',
        details: { reason?: string; exitCode?: number; type?: string; serviceName?: string },
        webContentsId?: number,
    ): Promise<void> {
        const reason = details.reason ?? 'unknown';
        const label = kind === 'renderer' ? 'Renderer process gone' : 'Child process gone';
        const error = new Error(`${label}: ${reason}`);
        const attrs: Record<string, string | number> = {
            'electron.process_gone.kind': kind,
            'electron.process_gone.reason': reason,
        };
        if (details.exitCode !== undefined) attrs['electron.process_gone.exit_code'] = details.exitCode;
        if (details.type !== undefined) attrs['electron.process_gone.type'] = details.type;
        if (details.serviceName !== undefined) attrs['electron.process_gone.service_name'] = details.serviceName;
        if (webContentsId !== undefined) attrs['electron.process_gone.web_contents_id'] = webContentsId;
        return this.report(error, attrs);
    }

    /**
     * Wait for both core's tracked reports AND forwarded renderer reports (which bypass core's
     * private track()), bounded by timeoutMs. The timeout is cleared when all reports settle
     * first, so the event loop is not kept alive unnecessarily.
     */
    flush(timeoutMs = 2000): Promise<void> {
        const settled = Promise.allSettled([super.flush(timeoutMs), ...this.forwardedInFlight]);
        return new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, timeoutMs);
            settled.then(() => {
                clearTimeout(timer);
                resolve();
            });
        });
    }

    /** Overlay main-authoritative config + Electron metadata + user onto a forwarded report, then send. */
    private receiveRendererReport(report: Report): Promise<void> {
        Object.assign(report.attributes, collectElectronAppAttributes(this.app), projectUser(this.user));
        if (this.mainStage) report.attributes['service.stage'] = this.mainStage;
        if (this.mainVersion) report.attributes['service.version'] = this.mainVersion;
        if (this.mainSourcemapVersionId) report.sourcemapVersionId = this.mainSourcemapVersionId;
        const sent = this.sendReport(report).finally(() => {
            this.forwardedInFlight.delete(sent);
        });
        this.forwardedInFlight.add(sent);
        return sent;
    }
}
