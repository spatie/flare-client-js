import type { FlushFn, FlushScheduler } from '@flareapp/core';

// Passive: the AppState -> background trigger lives in `Flare.install()`, to stay symmetric with handler
// teardown. No `{ keepalive: true }` — RN's fetch (XMLHttpRequest-based) doesn't honor it reliably.
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
