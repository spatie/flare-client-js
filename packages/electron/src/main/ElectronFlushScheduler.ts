import type { FlushFn, FlushScheduler } from '@flareapp/core';
import type { App } from 'electron';

/** Flushes pending logs/reports when the Electron app is quitting. App is injectable for tests. */
export class ElectronFlushScheduler implements FlushScheduler {
    private listener: (() => void) | null = null;

    constructor(private app: Pick<App, 'on' | 'off'>) {}

    register(flush: FlushFn): void {
        if (this.listener) {
            return; // already registered; never stack duplicate before-quit listeners
        }
        this.listener = () => {
            void flush();
        };
        this.app.on('before-quit', this.listener);
    }

    /** Detach the before-quit listener so a disposed ElectronFlare leaves no flush handler on the shared app. */
    dispose(): void {
        if (this.listener) {
            this.app.off('before-quit', this.listener);
            this.listener = null;
        }
    }
}
