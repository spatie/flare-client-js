import { AsyncLocalStorage } from 'node:async_hooks';

import type { ScopeProvider } from '@flareapp/core';

import type { RequestContext } from '../types';
import { NodeScope } from './NodeScope';

/**
 * `ScopeProvider` giving every in-flight request its own `NodeScope`, isolated from concurrent requests.
 *
 * Built on `node:async_hooks#AsyncLocalStorage`: inside `als.run(scope, fn)`, every `getStore()` from
 * `fn` and any async work it awaits (timers, promises, `process.nextTick`) returns that `scope`; outside
 * any run, `getStore()` returns `undefined`.
 *
 * Two reads surfaced separately:
 * - `active()` never returns null. The internal read for every glow/attribute/report. Returns the
 *   per-request scope inside `runWithContext`, else a shared `fallback` scope so outside-request work
 *   (process-level reports, startup errors, scheduled jobs) still lands somewhere.
 * - `getContext()` returns `null` outside `runWithContext` so callers can tell "inside a request" from
 *   "not". The fallback is deliberately not exposed here.
 *
 * The fallback is a per-instance `NodeScope`, so outside-scope writes persist for later outside reports.
 */
export class AsyncLocalStorageScopeProvider implements ScopeProvider {
    private als = new AsyncLocalStorage<NodeScope>();
    private fallback = new NodeScope();

    /** Per-request scope inside `runWithContext`, else the shared fallback. Never null. */
    active(): NodeScope {
        return this.als.getStore() ?? this.fallback;
    }

    /** Per-request scope inside `runWithContext`, else `null`. For "am I in a request?" checks. */
    getContext(): NodeScope | null {
        return this.als.getStore() ?? null;
    }

    /**
     * Open a fresh request scope around `fn` and run it. Every async hop inside `fn` sees the same scope
     * via `active()`/`getContext()`; concurrent calls each get their own. `request` is shallow-cloned so
     * later edits to the caller's object don't leak into the stored scope.
     */
    runWithContext<T>(request: RequestContext, fn: () => T): T {
        const scope = new NodeScope();
        scope.request = { ...request };
        return this.als.run(scope, fn);
    }

    /**
     * Patch the current scope's `request`. Inside `runWithContext`, visible to all later reads in the
     * same request chain; outside, lands on the fallback scope.
     */
    mergeContext(partial: Partial<RequestContext>): void {
        const scope = this.als.getStore() ?? this.fallback;
        scope.request = { ...scope.request, ...partial };
    }
}
