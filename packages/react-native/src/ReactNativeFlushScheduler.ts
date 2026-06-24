import type { FlushFn, FlushScheduler } from '@flareapp/core';

/**
 * Passive flush scheduler for React Native. Core's `Logger` calls `register`
 * once during construction; this stores the flush callback and exposes a plain,
 * argument-less caller via `getFlush()`. The actual trigger (AppState ->
 * background) is wired separately in `Flare.install()` so it stays symmetric
 * with handler teardown.
 *
 * Deliberately calls `flush()` WITHOUT `{ keepalive: true }`: RN's fetch (over
 * XMLHttpRequest) does not reliably honor keepalive, so a backgrounding flush is
 * best-effort and may be dropped if the OS suspends the app mid-request.
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
