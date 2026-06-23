import { AsyncLocalStorage } from 'node:async_hooks';

import type { ScopeProvider } from '@flareapp/core';

import type { RequestContext } from '../types';
import { NodeScope } from './NodeScope';

/**
 * `ScopeProvider` implementation that gives every in-flight request its own
 * `NodeScope`, isolated from concurrent requests.
 *
 * Built on Node's `node:async_hooks#AsyncLocalStorage`: when code runs inside
 * `als.run(scope, fn)`, every `als.getStore()` call from within `fn` (and any
 * async work `fn` awaits, including timers, promises, `process.nextTick`, etc)
 * returns that `scope`. Outside any `als.run` call, `getStore()` returns
 * `undefined`. This is the same primitive that lets observability libraries
 * propagate trace context across async boundaries without manual plumbing.
 *
 * Two "kinds of read" surfaced separately:
 *
 * - `active()` — never returns null. The internal read used by `Flare` for
 *   every glow, attribute set, and report. When called inside `runWithContext`,
 *   returns the per-request `NodeScope`. Outside, returns a shared `fallback`
 *   scope so glows/attributes/reports issued outside any request still have
 *   somewhere to land (process-level reports, startup errors, scheduled jobs).
 * - `getContext()` — public debug helper. Returns `null` outside any
 *   `runWithContext`, so consumers can distinguish "I am inside a request" from
 *   "I am not". The fallback is intentionally NOT exposed here.
 *
 * The fallback is also a per-instance `NodeScope` so that writes from outside
 * a request scope persist for subsequent outside-scope reports.
 */
export class AsyncLocalStorageScopeProvider implements ScopeProvider {
    private als = new AsyncLocalStorage<NodeScope>();
    private fallback = new NodeScope();

    /**
     * Internal: returns the per-request scope when inside `runWithContext`,
     * or the shared fallback otherwise. Always returns a real `NodeScope`.
     */
    active(): NodeScope {
        return this.als.getStore() ?? this.fallback;
    }

    /**
     * Public: returns the per-request scope when inside `runWithContext`, or
     * `null` otherwise. Useful for assertions like "am I in a request?".
     */
    getContext(): NodeScope | null {
        return this.als.getStore() ?? null;
    }

    /**
     * Open a fresh request scope around `fn` and run it. Every async hop
     * inside `fn` (awaits, timers, promise chains) sees the same scope via
     * `active()`/`getContext()`; concurrent calls each get their own.
     *
     * `request` is shallow-cloned so later edits to the caller's object do not
     * leak into the stored scope.
     */
    runWithContext<T>(request: RequestContext, fn: () => T): T {
        const scope = new NodeScope();
        scope.request = { ...request };
        return this.als.run(scope, fn);
    }

    /**
     * Patch the current scope's `request` shape. When called inside
     * `runWithContext`, the patch is visible to all subsequent reads from
     * within the same request chain. When called outside, the patch lands on
     * the fallback scope.
     */
    mergeContext(partial: Partial<RequestContext>): void {
        const scope = this.als.getStore() ?? this.fallback;
        scope.request = { ...scope.request, ...partial };
    }
}
