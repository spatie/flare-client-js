// @vitest-environment jsdom
import { resetNavigationSource } from '@flareapp/test-helpers';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Unsubscribe } from '../src/instrument/handlers';
import {
    activeNavigationToken,
    addNavigationHandler,
    registerNavigationSource,
    type NavigationHandler,
} from '../src/instrument/navigation';

function spyHandler() {
    return {
        onStart: vi.fn(),
        onRouteName: vi.fn(),
        onSettle: vi.fn(),
        onUnregister: vi.fn(),
    };
}

const subscriptions: Unsubscribe[] = [];

function listen(handler: NavigationHandler): void {
    subscriptions.push(addNavigationHandler(handler));
}

describe('navigation instrumentation', () => {
    afterEach(() => {
        // Drop the handlers before clearing the token, or the reset's unregister broadcasts into them.
        for (const off of subscriptions.splice(0)) {
            off();
        }
        resetNavigationSource(registerNavigationSource);
        window.history.replaceState({}, '', '/');
    });

    it('broadcasts a settle to every registered handler', () => {
        const first = spyHandler();
        const second = spyHandler();
        listen(first);
        listen(second);
        const src = registerNavigationSource();

        src.settleNavigation({ name: '/product/:id', source: 'route' });

        expect(first.onSettle).toHaveBeenCalledWith({ name: '/product/:id', source: 'route' });
        expect(second.onSettle).toHaveBeenCalledWith({ name: '/product/:id', source: 'route' });
    });

    // The unwelding. This file never imports the tracing module, so tracing has never started and has
    // no handler registered, and a source still reaches the handlers that are. Resolving the path from
    // the address bar is the instrumentation's own job now, not tracing's.
    it('broadcasts with no tracing handler registered', () => {
        window.history.replaceState({}, '', '/cart');
        const handler = spyHandler();
        listen(handler);
        const src = registerNavigationSource();

        src.startNavigation();
        src.setActiveRouteName({ name: '/cart', source: 'route' });

        expect(handler.onStart).toHaveBeenCalledWith({ path: '/cart', url: undefined, hold: undefined });
        expect(handler.onRouteName).toHaveBeenCalledWith({ name: '/cart', source: 'route' });
    });

    it('a superseded source broadcasts nothing', () => {
        const handler = spyHandler();
        listen(handler);
        const first = registerNavigationSource();
        registerNavigationSource(); // last-wins

        first.startNavigation({ path: '/b' });
        first.settleNavigation({ name: '/b', source: 'url' });
        first.unregister();

        expect(handler.onStart).not.toHaveBeenCalled();
        expect(handler.onSettle).not.toHaveBeenCalled();
        expect(handler.onUnregister).not.toHaveBeenCalled();
        expect(activeNavigationToken()).not.toBeNull(); // the stale handle did not tear down the newer one
    });

    it('a handler that throws does not stop the others', () => {
        const throwing = {
            onStart: vi.fn(() => {
                throw new Error('boom');
            }),
        };
        const handler = spyHandler();
        listen(throwing);
        listen(handler);
        const src = registerNavigationSource();

        expect(() => src.startNavigation({ path: '/b' })).not.toThrow();

        expect(throwing.onStart).toHaveBeenCalled();
        expect(handler.onStart).toHaveBeenCalledWith({ path: '/b', url: undefined, hold: undefined });
    });

    it('unregister broadcasts once and then goes quiet', () => {
        const seenTokens: Array<object | null> = [];
        const handler = {
            ...spyHandler(),
            // The token is cleared before the broadcast, so a handler cleaning up cannot mistake the
            // source it is being told about for one that is still registered.
            onUnregister: vi.fn(() => seenTokens.push(activeNavigationToken())),
        };
        listen(handler);
        const src = registerNavigationSource();

        src.unregister();
        src.unregister(); // stale now, so it says nothing
        src.startNavigation({ path: '/b' });

        expect(handler.onUnregister).toHaveBeenCalledTimes(1);
        expect(seenTokens).toEqual([null]);
        expect(handler.onStart).not.toHaveBeenCalled();
        expect(activeNavigationToken()).toBeNull();
    });
});
