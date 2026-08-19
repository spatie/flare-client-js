import type { FlushFn, FlushScheduler } from '@flareapp/core';

/**
 * Passive: the AppState -> background trigger is wired separately in `Flare.install()`, to stay symmetric
 * with handler teardown. Flushes without `{ keepalive: true }` because RN's fetch runs over XMLHttpRequest
 * and does not reliably honour it, so a backgrounding flush is best-effort.
 */
export class ReactNativeFlushScheduler implements FlushScheduler {
    private flushFn: FlushFn | null = null;

    register(flush: FlushFn): void {
        this.flushFn = flush;
    }

    getFlush(): (() => void) | undefined {
        const flush = this.flushFn;
        if (!flush) {
            return undefined;
        }
        return () => {
            void flush();
        };
    }
}
