import type { FlushFn, FlushScheduler } from '@flareapp/core';

/**
 * Passive flush scheduler for React Native. Core's `Logger` calls `register` once; this stores the flush
 * callback and exposes an argument-less caller via `getFlush()`. The trigger (AppState -> background) is
 * wired separately in `Flare.install()` to stay symmetric with handler teardown.
 *
 * Calls `flush()` without `{ keepalive: true }`: RN's fetch (over XMLHttpRequest) doesn't reliably honor
 * keepalive, so a backgrounding flush is best-effort and may drop if the OS suspends the app mid-request.
 */
export class ReactNativeFlushScheduler implements FlushScheduler {
    private flushFn: FlushFn | null = null;

    register(flush: FlushFn): void {
        this.flushFn = flush;
    }

    getFlush(): (() => void) | undefined {
        const flush = this.flushFn;
        if (!flush) return undefined;
        return () => {
            void flush();
        };
    }
}
