import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProcessHandlerManager } from '../src/process/handlers';

describe('ProcessHandlerManager', () => {
    let manager: ProcessHandlerManager;

    afterEach(() => {
        manager?.detach();
    });

    it('attaches no listeners when modes are off', () => {
        const before = process.listeners('uncaughtException').length;
        const beforeR = process.listeners('unhandledRejection').length;
        manager = new ProcessHandlerManager({
            onUncaught: vi.fn(),
            onRejection: vi.fn(),
        });
        manager.reconcile({ uncaughtExceptionMode: 'off', unhandledRejectionMode: 'off' });
        expect(process.listeners('uncaughtException').length).toBe(before);
        expect(process.listeners('unhandledRejection').length).toBe(beforeR);
    });

    it('attaches handlers when modes are report or report-and-exit', () => {
        const before = process.listeners('uncaughtException').length;
        manager = new ProcessHandlerManager({ onUncaught: vi.fn(), onRejection: vi.fn() });
        manager.reconcile({ uncaughtExceptionMode: 'report', unhandledRejectionMode: 'report' });
        expect(process.listeners('uncaughtException').length).toBe(before + 1);
    });

    it('detaches when mode flips back to off', () => {
        const before = process.listeners('uncaughtException').length;
        manager = new ProcessHandlerManager({ onUncaught: vi.fn(), onRejection: vi.fn() });
        manager.reconcile({ uncaughtExceptionMode: 'report', unhandledRejectionMode: 'off' });
        expect(process.listeners('uncaughtException').length).toBe(before + 1);
        manager.reconcile({ uncaughtExceptionMode: 'off', unhandledRejectionMode: 'off' });
        expect(process.listeners('uncaughtException').length).toBe(before);
    });

    it('is idempotent — does not attach twice on repeated reconcile', () => {
        const before = process.listeners('uncaughtException').length;
        manager = new ProcessHandlerManager({ onUncaught: vi.fn(), onRejection: vi.fn() });
        manager.reconcile({ uncaughtExceptionMode: 'report', unhandledRejectionMode: 'off' });
        manager.reconcile({ uncaughtExceptionMode: 'report', unhandledRejectionMode: 'off' });
        expect(process.listeners('uncaughtException').length).toBe(before + 1);
    });
});
