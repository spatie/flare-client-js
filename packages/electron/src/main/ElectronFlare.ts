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
        this.options = { ...this.options, ...partial };
        if (this.isLit) this.handlerManager.reconcile(this.options);
        return this;
    }

    setUser(user: ElectronUser | null): void {
        this.user = user;
    }

    dispose(): void {
        this.handlerManager.detach();
        disposeIpcReceiver(this.ipcMain, this);
    }

    /** Overlay main-authoritative config + Electron metadata + user onto a forwarded report, then send. */
    private receiveRendererReport(report: Report): Promise<void> {
        Object.assign(report.attributes, collectElectronAppAttributes(this.app), projectUser(this.user));
        if (this.mainStage) report.attributes['service.stage'] = this.mainStage;
        if (this.mainVersion) report.attributes['service.version'] = this.mainVersion;
        if (this.mainSourcemapVersionId) report.sourcemapVersionId = this.mainSourcemapVersionId;
        return this.sendReport(report);
    }
}
