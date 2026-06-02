import type { Attributes, AttributeValue, EntryPointHandler, Glow } from './types';

/**
 * Holds the per-call mutable state that used to live on the `Flare` instance:
 * breadcrumbs (`glows`), custom attributes (`pendingAttributes`), and the
 * current entry-point handler.
 *
 * Why this exists as its own class: in the browser there is one `Flare` per
 * page and one user at a time, so a single shared bag of state is fine. In
 * Node, a single `Flare` instance serves many concurrent requests, and each
 * request wants its own breadcrumbs and its own custom context that do NOT
 * leak into other requests. Splitting this state out of `Flare` lets the
 * consumer choose: one global `Scope` (browser) or one `Scope` per request
 * via AsyncLocalStorage (Node).
 *
 * `Flare` reads and writes this through `scopeProvider.active()` instead of
 * holding the state directly, so the per-request behavior comes from the
 * provider, not from the class itself.
 *
 * `NodeScope` (in `@flareapp/node`) extends this with two more buckets:
 * `request` (HTTP method, path, headers) and `user` (id, email, ...). Browser
 * does not need those.
 */
export class Scope {
    glows: Glow[] = [];
    pendingAttributes: Attributes = {};
    entryPoint: EntryPointHandler | null = null;

    /**
     * Append a breadcrumb. Caps the list at `maxGlowsPerReport` by dropping the
     * OLDEST entries when the limit is exceeded; this keeps reports below a
     * payload-size threshold while preserving the most recent events leading
     * up to an error.
     *
     * `slice(length - max)` returns the trailing `max` items, which is the
     * shortest way to drop from the front and keep insertion order.
     */
    addGlow(glow: Glow, maxGlowsPerReport: number): void {
        this.glows.push(glow);
        if (this.glows.length > maxGlowsPerReport) {
            this.glows = this.glows.slice(this.glows.length - maxGlowsPerReport);
        }
    }

    clearGlows(): void {
        this.glows = [];
    }

    /**
     * Set a single attribute on this scope. Called from `Flare.addContext` and
     * `Flare.addContextGroup`. Last write wins.
     */
    setAttribute(key: string, value: AttributeValue): void {
        this.pendingAttributes[key] = value;
    }

    /**
     * Shallow-merge a bag of attributes into this scope. Used by Node's
     * AsyncLocalStorage provider when patching the live request context via
     * `flare.mergeContext({ ... })`. Last write wins per key; nested objects
     * are NOT deep-merged.
     */
    mergeAttributes(partial: Attributes): void {
        Object.assign(this.pendingAttributes, partial);
    }
}

/**
 * The seam through which `Flare` reaches its current `Scope`. Implementations
 * decide what "current" means.
 *
 * - `GlobalScopeProvider` always returns the same `Scope` instance (browser).
 * - `AsyncLocalStorageScopeProvider` in `@flareapp/node` returns the per-request
 *   `NodeScope` stored in `node:async_hooks` for the in-flight async chain,
 *   falling back to a single shared scope when called outside any
 *   `runWithContext(...)` callback.
 *
 * Any consumer of `@flareapp/core` can supply its own provider to plug in
 * different "current scope" semantics.
 */
export interface ScopeProvider {
    active(): Scope;
}

/**
 * The simplest provider: one `Scope` for the lifetime of the provider, shared
 * by every caller. This is the right default for environments with a single
 * logical context (browser tab, CLI script, etc.) and is the default that
 * `Flare`'s constructor falls back to when no provider is supplied.
 */
export class GlobalScopeProvider implements ScopeProvider {
    private scope = new Scope();
    active(): Scope {
        return this.scope;
    }
}
