import { AppState } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { installAppStateFlush } from '../src/handlers/appStateFlush';

afterEach(() => AppState.__reset());

describe('installAppStateFlush', () => {
    it('flushes on background but not on inactive or active', () => {
        const flush = vi.fn();
        installAppStateFlush(() => flush);

        AppState.__emit('inactive');
        AppState.__emit('active');
        expect(flush).not.toHaveBeenCalled();

        AppState.__emit('background');
        expect(flush).toHaveBeenCalledTimes(1);
    });

    it('reads getFlush at event time (late binding), not at install time', () => {
        const flush = vi.fn();
        let current: (() => void) | undefined;
        installAppStateFlush(() => current);

        // No flush registered yet at the first background transition.
        AppState.__emit('background');
        expect(flush).not.toHaveBeenCalled();

        // Flush becomes available later; the next transition picks it up.
        current = flush;
        AppState.__emit('background');
        expect(flush).toHaveBeenCalledTimes(1);
    });

    it('uninstall removes the listener', () => {
        const flush = vi.fn();
        const uninstall = installAppStateFlush(() => flush);
        uninstall();

        AppState.__emit('background');
        expect(flush).not.toHaveBeenCalled();
    });

    it('does not throw when no flush is available', () => {
        installAppStateFlush(() => undefined);
        expect(() => AppState.__emit('background')).not.toThrow();
    });
});
