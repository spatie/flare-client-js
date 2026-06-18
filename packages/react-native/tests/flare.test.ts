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

// `{ enable: null }` disables the rejection hook so light() does NOT enable a
// real global rejection tracker as a leaking side effect (the `promise` package
// may resolve in the node test env, or a HermesInternal stub could be present).
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

    it('setUser is reflected in the collected report attributes', async () => {
        const ctl = stubErrorUtils();
        const flare = makeFlare();
        const fake = withFakeApi(flare);
        flare.light('k');
        flare.setUser({ id: 42, email: 'u@x.io', username: 'neo' });

        ctl.emit(new Error('with-user'), false);
        await vi.waitFor(() => expect(fake.reports.length).toBe(1));

        // The collector projects the user into core's `Report.attributes`
        // (`packages/core/src/types.ts`), keyed `enduser.email` by
        // `makeReactNativeContextCollector`. Assert that path directly.
        expect(fake.lastReport?.attributes['enduser.email']).toBe('u@x.io');
        expect(fake.lastReport?.attributes['enduser.id']).toBe('42');
        expect(fake.lastReport?.attributes['enduser.username']).toBe('neo');
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
});
