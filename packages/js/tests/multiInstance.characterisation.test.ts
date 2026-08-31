// @vitest-environment jsdom
// CHARACTERISATION, NOT DESIRED BEHAVIOUR. Pins what two Flare instances (or two bundled copies of
// @flareapp/js) do today. Multi-instance patch ownership is deliberately unplanned; see
// docs/superpowers/plans/2026-07-30-pr80-review-index.md. These assertions are meant to flip once
// ownership is fixed.

import { nativeFetchStub } from '@flareapp/test-helpers';
import { afterEach, describe, expect, it } from 'vitest';

import { Flare } from '../src/browser';
import { unpatchFetch } from '../src/instrumentation/requests';
import { unpatchXHR } from '../src/instrumentation/requests';
import { resetRequestPatches } from '../src/instrumentation/requests';
import { stopBrowserTracing } from '../src/tracing/roots';
import { createPatcher } from '../src/tracing/utils';

describe('multi-instance tracing (characterisation)', () => {
    describe('two Flare instances share one module-level fetch patch', () => {
        const g = globalThis as { fetch: typeof fetch };
        const originalFetch = g.fetch;

        afterEach(() => {
            // instrumentFetch/browserTracing/instrumentXHR are module-level singletons shared by
            // every test in this process, so a leftover install here would leak into other files.
            stopBrowserTracing();
            unpatchFetch();
            unpatchXHR();
            resetRequestPatches();
            g.fetch = originalFetch;
        });

        it('instance B disabling tracing leaves the patch installed, but takes the mutation slot with it', () => {
            const nativeFetch = nativeFetchStub();
            g.fetch = nativeFetch;

            const a = new Flare();
            a.configure({ enableTracing: true, tracesSampleRate: 1 });
            const patched = g.fetch;
            expect(patched).not.toBe(nativeFetch);

            const b = new Flare();
            b.configure({ enableTracing: true, tracesSampleRate: 1 });
            // Same patch. The count includes B, so B joins the install instead of making a second one.
            expect(g.fetch).toBe(patched);

            b.configure({ enableTracing: false });

            // FIXED by the subscription count: B no longer removes the patch that A needs.
            expect(g.fetch).toBe(patched);
            expect(a.config.enableTracing).toBe(true);

            // STILL BROKEN, differently: one mutation slot exists, B claimed it second, and empties
            // it on the way out. A then sends no traceparent but still believes it traces. Slot
            // ownership across instances is out of scope; see
            // docs/superpowers/plans/2026-07-30-pr80-review-index.md.
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
