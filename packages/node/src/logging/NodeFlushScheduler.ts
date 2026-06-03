import type { FlushFn, FlushScheduler } from '@flareapp/core';

export class NodeFlushScheduler implements FlushScheduler {
    register(flush: FlushFn): void {
        process.on('beforeExit', () => flush());
    }
}
