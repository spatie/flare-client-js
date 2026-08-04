// @vitest-environment jsdom
// CHARACTERISATION, NOT DESIRED BEHAVIOUR. These tests pin what two Flare instances (or two bundled
// copies of @flareapp/js) do today. Multi-instance patch ownership is deliberately unplanned; see
// docs/superpowers/plans/2026-07-30-pr80-review-index.md. When ownership is fixed, these assertions
// are expected to flip, and flipping them is the point.

import { afterEach, describe, expect, it } from 'vitest';

import { Flare } from '../src/browser';
import { stopBrowserTracing } from '../src/tracing/browserTracing';
import { createPatcher } from '../src/tracing/createPatcher';
import { unpatchFetch } from '../src/tracing/instrumentFetch';
import { unpatchXHR } from '../src/tracing/instrumentXHR';

// isNativeFetch checks Function.prototype.toString for "native code". A bound function reports
// that from the prototype method (an own toString override would not), so this stands in for the
// browser's real fetch without needing a DOM fetch implementation.
function nativeFetchStub(): typeof fetch {
    // oxlint-disable-next-line no-extra-bind
    return (async () => new Response(null, { status: 200 })).bind(null) as unknown as typeof fetch;
}

describe('multi-instance tracing (characterisation)', () => {
    describe('two Flare instances share one module-level fetch patch', () => {
        const g = globalThis as { fetch: typeof fetch };
        const originalFetch = g.fetch;

        afterEach(() => {
            // instrumentFetch/browserTracing/instrumentXHR are module-level singletons: every test in
            // this process shares them, so a leftover install here would leak into unrelated files.
            stopBrowserTracing();
            unpatchFetch();
            unpatchXHR();
            g.fetch = originalFetch;
        });

        it('instance B disabling tracing tears down instance A and A never re-arms', () => {
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

            // Today: B's teardown removes the patch A installed, and A is not told.
            expect(g.fetch).toBe(nativeFetch);
            expect(a.config.enableTracing).toBe(true);

            // And A cannot get it back: its own config never transitioned false to true, so calling
            // configure again with the value it already holds installs nothing.
            a.configure({ enableTracing: true });
            expect(g.fetch).toBe(nativeFetch);
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
