import { afterEach, describe, expect, it, vi } from 'vitest';

import { NodeFlushScheduler } from '../src/logging/NodeFlushScheduler';

afterEach(() => vi.restoreAllMocks());

describe('NodeFlushScheduler', () => {
    it('flushes on process beforeExit', () => {
        const handlers: Array<() => void> = [];
        const onSpy = vi.spyOn(process, 'on').mockImplementation(((event: string, cb: () => void) => {
            if (event === 'beforeExit') handlers.push(cb);
            return process;
        }) as typeof process.on);

        const flush = vi.fn();
        new NodeFlushScheduler().register(flush);
        handlers.forEach((h) => h());

        expect(onSpy).toHaveBeenCalledWith('beforeExit', expect.any(Function));
        expect(flush).toHaveBeenCalledTimes(1);
    });
});
