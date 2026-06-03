import { afterEach, describe, expect, it, vi } from 'vitest';

import { BrowserFlushScheduler } from '../src/browser/BrowserFlushScheduler';

afterEach(() => vi.restoreAllMocks());

describe('BrowserFlushScheduler', () => {
    it('flushes with keepalive when the document becomes hidden', () => {
        const listeners: Record<string, () => void> = {};
        vi.stubGlobal('document', {
            addEventListener: (type: string, cb: () => void) => {
                listeners[type] = cb;
            },
            visibilityState: 'hidden',
        });

        const flush = vi.fn();
        new BrowserFlushScheduler().register(flush);
        listeners['visibilitychange']();

        expect(flush).toHaveBeenCalledWith({ keepalive: true });
    });
});
