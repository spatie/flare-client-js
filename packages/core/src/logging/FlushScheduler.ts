export type FlushFn = (opts?: { keepalive?: boolean }) => void;

/**
 * The seam through which a platform package wires the "drain on lifecycle end"
 * trigger (browser unload, Node process exit). Core ships a no-op default; the
 * count/weight/timer batching policy lives in `Logger` regardless.
 */
export interface FlushScheduler {
    register(flush: FlushFn): void;
}

export class NoopFlushScheduler implements FlushScheduler {
    register(): void {}
}
