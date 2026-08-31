import type { FlushFn, FlushScheduler } from '@flareapp/core';

export class BrowserFlushScheduler implements FlushScheduler {
    register(flush: FlushFn): void {
        if (typeof document === 'undefined' || !document) {
            return;
        }
        // Both events, since neither fires alone: iOS Safari can skip visibilitychange before pagehide,
        // and a tab switch skips pagehide. Flushing twice is safe because a drained buffer is a no-op.
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                flush({ keepalive: true });
            }
        });
        if (typeof window !== 'undefined' && window) {
            window.addEventListener('pagehide', () => flush({ keepalive: true }));
        }
    }
}
