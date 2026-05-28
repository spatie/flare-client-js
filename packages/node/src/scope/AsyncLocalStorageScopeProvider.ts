import { AsyncLocalStorage } from 'node:async_hooks';

import type { ScopeProvider } from '@flareapp/core';

import type { RequestContext, User } from '../types';
import { NodeScope } from './NodeScope';

export class AsyncLocalStorageScopeProvider implements ScopeProvider {
    private als = new AsyncLocalStorage<NodeScope>();
    private fallback = new NodeScope();

    active(): NodeScope {
        return this.als.getStore() ?? this.fallback;
    }

    getContext(): NodeScope | null {
        return this.als.getStore() ?? null;
    }

    runWithContext<T>(request: RequestContext, fn: () => T): T {
        const scope = new NodeScope();
        scope.request = { ...request };
        return this.als.run(scope, fn);
    }

    mergeContext(partial: Partial<RequestContext>): void {
        const scope = this.als.getStore() ?? this.fallback;
        scope.request = { ...scope.request, ...partial };
    }

    setUser(user: User | null): void {
        const scope = this.als.getStore() ?? this.fallback;
        scope.user = user;
    }
}
