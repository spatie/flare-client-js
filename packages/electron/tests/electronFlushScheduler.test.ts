import { describe, expect, it, vi } from 'vitest';

import { ElectronFlushScheduler } from '../src/main/ElectronFlushScheduler';

describe('ElectronFlushScheduler', () => {
    it('flushes when the app emits before-quit', () => {
        const handlers: Record<string, (() => void)[]> = {};
        const app = {
            on(event: string, cb: () => void) {
                (handlers[event] ??= []).push(cb);
            },
        };
        const flush = vi.fn();
        new ElectronFlushScheduler(app as any).register(flush);

        expect(handlers['before-quit']?.length).toBe(1);
        handlers['before-quit'][0]();
        expect(flush).toHaveBeenCalledTimes(1);
    });
});
