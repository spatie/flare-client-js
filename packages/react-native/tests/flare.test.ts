import { AppState } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReactNativeFlare } from '../src/Flare';
import { FakeApi } from './helpers/FakeApi';

type Handler = (error: unknown, isFatal?: boolean) => void;

function stubErrorUtils() {
    let current: Handler | undefined;
    (globalThis as Record<string, unknown>).ErrorUtils = {
        getGlobalHandler: () => current,
        setGlobalHandler: (cb: Handler) => {
            current = cb;
        },
    };
    return { emit: (e: unknown, f?: boolean) => current?.(e, f) };
}

/** Swap core's Api for a FakeApi so reports are captured, not sent. */
function withFakeApi(flare: ReactNativeFlare): FakeApi {
    const fake = new FakeApi();
    (flare as unknown as { api: FakeApi }).api = fake;
    return fake;
}

afterEach(() => {
    delete (globalThis as Record<string, unknown>).ErrorUtils;
    AppState.__reset();
    vi.restoreAllMocks();
});

// `{ enable: null }` disables the rejection hook so light() installs no leaking global tracker (the
// `promise` package may resolve in the node test env, or a HermesInternal stub could be present).
function makeFlare(): ReactNativeFlare {
    return new ReactNativeFlare({ enable: null });
}

describe('ReactNativeFlare', () => {
    it('light() installs the global handler and reports caught errors', async () => {
        const ctl = stubErrorUtils();
        const flare = makeFlare();
        const fake = withFakeApi(flare);
        flare.light('test-key');

        ctl.emit(new Error('caught'), false);
        await vi.waitFor(() => expect(fake.reports.length).toBe(1));
    });

    it('attaches the error.fatal attribute reflecting isFatal', async () => {
        const ctl = stubErrorUtils();
        const flare = makeFlare();
        const fake = withFakeApi(flare);
        flare.light('k');

        ctl.emit(new Error('fatal-crash'), true);
        await vi.waitFor(() => expect(fake.reports.length).toBe(1));
        expect(fake.lastReport?.attributes['error.fatal']).toBe(true);
    });

    it('light() is idempotent: two calls do not double-report', async () => {
        const ctl = stubErrorUtils();
        const flare = makeFlare();
        const fake = withFakeApi(flare);
        flare.light('k');
        flare.light('k');

        ctl.emit(new Error('once'), false);
        await vi.waitFor(() => expect(fake.reports.length).toBe(1));
        // Give any erroneous second report a chance to land, then re-assert.
        await new Promise((r) => setTimeout(r, 20));
        expect(fake.reports.length).toBe(1);
    });

    it('setUser is reflected in the report via core user.* identity keys', async () => {
        const ctl = stubErrorUtils();
        const flare = makeFlare();
        const fake = withFakeApi(flare);
        flare.light('k');
        // setUser (inherited from core): known fields project to `user.*` keys, extras to `user.attributes`.
        flare.setUser({ id: 42, email: 'u@x.io', fullName: 'Neo Anderson', role: 'admin' });

        ctl.emit(new Error('with-user'), false);
        await vi.waitFor(() => expect(fake.reports.length).toBe(1));

        expect(fake.lastReport?.attributes['user.email']).toBe('u@x.io');
        expect(fake.lastReport?.attributes['user.id']).toBe('42');
        expect(fake.lastReport?.attributes['user.full_name']).toBe('Neo Anderson');
        expect(fake.lastReport?.attributes['user.attributes']).toEqual({ role: 'admin' });
    });

    it('install() wires the rejection reporter (Error reason -> report)', async () => {
        stubErrorUtils();
        let onUnhandled: ((id: number, error: unknown) => void) | undefined;
        const enable = (o: { onUnhandled?: (id: number, error: unknown) => void }) => {
            onUnhandled = o.onUnhandled;
        };
        const flare = new ReactNativeFlare({ enable });
        const fake = withFakeApi(flare);
        flare.light('k');

        onUnhandled?.(1, new Error('rej-boom'));
        await vi.waitFor(() => expect(fake.reports.length).toBe(1));
        expect(JSON.stringify(fake.lastReport)).toContain('rej-boom');
    });

    it('removeHandlers detaches: emitting after no longer reports', async () => {
        const ctl = stubErrorUtils();
        const flare = makeFlare();
        const fake = withFakeApi(flare);
        flare.light('k');
        flare.removeHandlers();

        ctl.emit(new Error('after-remove'), false);
        await new Promise((r) => setTimeout(r, 20));
        expect(fake.reports.length).toBe(0);
    });

    it('removeHandlers then light re-installs', async () => {
        const ctl = stubErrorUtils();
        const flare = makeFlare();
        const fake = withFakeApi(flare);
        flare.light('k');
        flare.removeHandlers();
        flare.light('k');

        ctl.emit(new Error('reinstalled'), false);
        await vi.waitFor(() => expect(fake.reports.length).toBe(1));
    });

    it('removeHandlers is exception-safe: a throwing uninstaller does not strand the rest', async () => {
        const ctl = stubErrorUtils();
        const flare = makeFlare();
        const fake = withFakeApi(flare);
        flare.light('k');

        // Inject a throwing uninstaller ahead of the real ones to simulate a
        // malformed teardown (e.g. a bad AppState subscription).
        const uninstallers = (flare as unknown as { uninstallers: Array<() => void> }).uninstallers;
        uninstallers.unshift(() => {
            throw new Error('teardown boom');
        });

        expect(() => flare.removeHandlers()).not.toThrow();

        // The real global-handler uninstaller still ran (emitting no longer
        // reports) and the install guard was cleared so light() can re-install.
        ctl.emit(new Error('after-remove'), false);
        await new Promise((r) => setTimeout(r, 20));
        expect(fake.reports.length).toBe(0);

        flare.light('k');
        ctl.emit(new Error('reinstalled'), false);
        await vi.waitFor(() => expect(fake.reports.length).toBe(1));
    });

    it('flushes on AppState background through the wired scheduler, and stops after removeHandlers', () => {
        stubErrorUtils();
        const flare = makeFlare();
        withFakeApi(flare);
        flare.light('k');

        // The install wires `installAppStateFlush(() => this.scheduler.getFlush())`,
        // so a `background` transition pulls the scheduler's flush and invokes it.
        const scheduler = (flare as unknown as { scheduler: { getFlush: () => (() => void) | undefined } }).scheduler;
        const flush = vi.fn();
        vi.spyOn(scheduler, 'getFlush').mockReturnValue(flush);

        AppState.__emit('background');
        expect(flush).toHaveBeenCalledTimes(1);

        // A non-background transition does not flush.
        AppState.__emit('inactive');
        expect(flush).toHaveBeenCalledTimes(1);

        // removeHandlers detaches the AppState listener too (not just the error handler).
        flare.removeHandlers();
        AppState.__emit('background');
        expect(flush).toHaveBeenCalledTimes(1);
    });
});

describe('ReactNativeFlare framework identity', () => {
    it('tags the framework as React Native by default (no boundary needed)', async () => {
        const flare = makeFlare();
        const fake = withFakeApi(flare);
        flare.light('k');

        await flare.report(new Error('x'));

        expect(fake.lastReport?.attributes['flare.framework.name']).toBe('React Native');
        const custom = fake.lastReport?.attributes['context.custom'] as Record<string, unknown> | undefined;
        expect(custom?.framework).toBe('react native');
    });

    it('coerces the wrapped @flareapp/react boundary tag (React) to React Native', async () => {
        const flare = makeFlare();
        const fake = withFakeApi(flare);
        flare.light('k');

        // Simulate @flareapp/react's tagReactFramework() running on the RN
        // singleton when the wrapped /inject boundary mounts.
        flare.setFramework({ name: 'React', version: '19.2.3' });

        await flare.report(new Error('x'));

        expect(fake.lastReport?.attributes['flare.framework.name']).toBe('React Native');
        // The React version the boundary supplied is preserved.
        expect(fake.lastReport?.attributes['flare.framework.version']).toBe('19.2.3');
    });
});
