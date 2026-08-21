// @vitest-environment jsdom
// CHARACTERISATION, NOT DESIRED BEHAVIOUR. These tests pin what two Flare instances (or two bundled
// copies of @flareapp/js) do today. Multi-instance patch ownership is deliberately unplanned; see
// docs/superpowers/plans/2026-07-30-pr80-review-index.md. When ownership is fixed, these assertions
// are expected to flip, and flipping them is the point.

import { nativeFetchStub } from '@flareapp/test-helpers';
import { afterEach, describe, expect, it } from 'vitest';

import { Flare } from '../src/browser';
import { resetRequestInstrumentationForTests } from '../src/instrument/request';
import { stopBrowserTracing } from '../src/tracing/browserTracing';
import { createPatcher } from '../src/tracing/createPatcher';

describe('multi-instance tracing (characterisation)', () => {
    describe('two Flare instances share one module-level fetch patch', () => {
        const g = globalThis as { fetch: typeof fetch };
        const originalFetch = g.fetch;

        afterEach(() => {
            // The request handlers and browserTracing are module-level singletons: every test in
            // this process shares them, so a leftover install here would leak into unrelated files.
            stopBrowserTracing();
            resetRequestInstrumentationForTests();
            g.fetch = originalFetch;
        });

        it('instance B disabling tracing no longer tears down instance A', () => {
            const nativeFetch = nativeFetchStub();
            g.fetch = nativeFetch;

            const a = new Flare();
            a.configure({ enableTracing: true, tracesSampleRate: 1 });
            const patchedByA = g.fetch;
            expect(patchedByA).not.toBe(nativeFetch);

            const b = new Flare();
            b.configure({ enableTracing: true, tracesSampleRate: 1 });
            // A's transition already happened, so B's `true` is a no-op: same patch, A still owns it.
            expect(g.fetch).toBe(patchedByA);

            b.configure({ enableTracing: false });

            // The handler registry changed this pin: B's start registration was refused and its
            // settle registration deduplicated, so B's teardown releases nothing. Before the
            // registry, B's disable unpatched the fetch A installed.
            expect(g.fetch).toBe(patchedByA);
            expect(a.config.enableTracing).toBe(true);

            a.configure({ enableTracing: true });
            expect(g.fetch).toBe(patchedByA);
        });
    });

    describe('two module copies of the patcher factory', () => {
        it('a second module copy claims installed:true without patching, then unfills the first copy wrapper', () => {
            type Target = { send: () => string };
            const nativeSend = (): string => 'native';
            const wrap = (original: () => string): (() => string) => {
                return function wrapped(): string {
                    return original();
                };
            };

            // createPatcher() is a factory, so two calls stand in for two bundled module copies: each
            // gets its own `installed` flag, but they patch the same target object.
            const copyA = createPatcher<Target>();
            const copyB = createPatcher<Target>();
            const target: Target = { send: nativeSend };

            copyA.install(target, { send: wrap });
            const wrappedByA = target.send;
            expect(wrappedByA).not.toBe(nativeSend);

            // B sees the tag copyA left on target.send and skips wrapping, but still flips its own
            // installed flag: fill() no-ops on an already-tagged method, install() does not.
            copyB.install(target, { send: wrap });
            expect(target.send).toBe(wrappedByA);
            expect(copyB.installed).toBe(true);

            // So B believes it owns the install, and strips A's wrapper while A still believes it is
            // installed (copyA.installed never changes: A never called uninstall).
            copyB.uninstall(target);
            expect(target.send).toBe(nativeSend);
            expect(copyA.installed).toBe(true);
        });
    });
});
