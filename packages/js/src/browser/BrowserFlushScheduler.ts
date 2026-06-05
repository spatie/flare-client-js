import type { FlushFn, FlushScheduler } from '@flareapp/core';

export class BrowserFlushScheduler implements FlushScheduler {
    register(flush: FlushFn): void {
        if (typeof document === 'undefined' || !document) return;
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                flush({ keepalive: true });
            }
        });
    }
}
