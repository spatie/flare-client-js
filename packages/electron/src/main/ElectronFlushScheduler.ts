import type { FlushFn, FlushScheduler } from '@flareapp/core';
import type { App } from 'electron';

/** Flushes pending logs/reports when the Electron app is quitting. App is injectable for tests. */
export class ElectronFlushScheduler implements FlushScheduler {
    constructor(private app: Pick<App, 'on'>) {}

    register(flush: FlushFn): void {
        this.app.on('before-quit', () => {
            void flush();
        });
    }
}
