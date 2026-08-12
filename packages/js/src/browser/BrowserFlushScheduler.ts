import type { FlushFn, FlushScheduler } from '@flareapp/core';

export class BrowserFlushScheduler implements FlushScheduler {
    register(flush: FlushFn): void {
        if (typeof document === 'undefined' || !document) {
            return;
        }
        // Both events, because neither is reliable alone: iOS Safari can fire pagehide with no preceding
        // visibilitychange, and a plain tab switch fires visibilitychange with no pagehide. Flushing an
        // already-drained buffer is a no-op, so the overlap costs nothing.
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
