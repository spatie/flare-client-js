import { describe, expect, it, vi } from 'vitest';

import { ReactNativeFlushScheduler } from '../src/ReactNativeFlushScheduler';

describe('ReactNativeFlushScheduler', () => {
    it('getFlush is undefined before register', () => {
        expect(new ReactNativeFlushScheduler().getFlush()).toBeUndefined();
    });

    it('getFlush invokes the registered flush with no arguments', () => {
        const scheduler = new ReactNativeFlushScheduler();
        const flush = vi.fn();
        scheduler.register(flush);
        scheduler.getFlush()?.();
        expect(flush).toHaveBeenCalledTimes(1);
        expect(flush).toHaveBeenCalledWith();
    });
});
