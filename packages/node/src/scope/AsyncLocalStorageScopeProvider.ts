import { AsyncLocalStorage } from 'node:async_hooks';

import type { ScopeProvider } from '@flareapp/core';

import type { RequestContext } from '../types';
import { NodeScope } from './NodeScope';

// Gives every in-flight request its own `NodeScope`, isolated from concurrent requests. The `fallback`
// scope catches work outside any request (startup errors, scheduled jobs) and persists per-instance, so
// outside-scope writes survive for a later outside report.
export class AsyncLocalStorageScopeProvider implements ScopeProvider {
    private als = new AsyncLocalStorage<NodeScope>();
    private fallback = new NodeScope();

    // Never null: falls back to the shared scope outside `runWithContext`.
    active(): NodeScope {
        return this.als.getStore() ?? this.fallback;
    }

    // Null outside `runWithContext`, so callers can tell "inside a request" from "not".
    getContext(): NodeScope | null {
        return this.als.getStore() ?? null;
    }

    // `request` is shallow-cloned so later edits to the caller's object do not leak into the scope.
    runWithContext<T>(request: RequestContext, fn: () => T): T {
        const scope = new NodeScope();
        scope.request = { ...request };
        return this.als.run(scope, fn);
    }

    mergeContext(partial: Partial<RequestContext>): void {
        const scope = this.als.getStore() ?? this.fallback;
        scope.request = { ...scope.request, ...partial };
    }
}
