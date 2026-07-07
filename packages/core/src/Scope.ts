import type { Attributes, AttributeValue, EntryPointHandler, Glow } from './types';

/**
 * Maps each `User` identity field to the flat report attribute key it projects to. `Flare.setUser` writes through
 * these; `USER_IDENTITY_KEYS` (the clear pass) derives from them, so a new field can never leave the clear pass stale.
 */
export const USER_FIELD_KEYS = {
    id: 'user.id',
    email: 'user.email',
    fullName: 'user.full_name',
    ipAddress: 'client.address',
} as const;

/**
 * Attribute keys `Flare.setUser` owns: the four projected identity fields plus the `user.attributes` bag. Single
 * source of truth so the set/clear passes cannot drift, and so consumers stamping identity outside core's report
 * pipeline (Electron's forwarded-renderer path) reuse the exact same set.
 */
export const USER_IDENTITY_KEYS = [...Object.values(USER_FIELD_KEYS), 'user.attributes'] as const;

/**
 * Pick the user-identity attributes currently set on a scope. Used where identity must be copied onto a report that
 * does not flow through `Flare.report()` (which would otherwise spread `pendingAttributes` automatically).
 */
export function userIdentityAttributes(scope: Scope): Attributes {
    const attrs: Attributes = {};
    for (const key of USER_IDENTITY_KEYS) {
        const value = scope.pendingAttributes[key];
        if (value !== undefined) attrs[key] = value;
    }
    return attrs;
}

/**
 * Per-call mutable state: breadcrumbs (`glows`), custom attributes (`pendingAttributes`), and the current entry-point
 * handler. Split out of `Flare` so the consumer can choose a single global `Scope` (browser, one user at a time) or one
 * `Scope` per request via AsyncLocalStorage (Node, concurrent requests must not leak into each other). `Flare` reaches
 * it through `scopeProvider.active()`, so per-request behavior lives in the provider.
 *
 * `NodeScope` (in `@flareapp/node`) extends this with a `request` bucket (method, path, headers). User identity goes to
 * `pendingAttributes` via `Flare.setUser`, so it needs no dedicated field.
 */
export class Scope {
    glows: Glow[] = [];
    pendingAttributes: Attributes = {};
    entryPoint: EntryPointHandler | null = null;

    /**
     * Append a breadcrumb, capping the list at `maxGlowsPerReport` by dropping the oldest entries. Keeps the payload
     * bounded while preserving the most recent events leading up to an error.
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

    /** Set a single attribute (`Flare.addContext` / `addContextGroup`). Last write wins. */
    setAttribute(key: string, value: AttributeValue): void {
        this.pendingAttributes[key] = value;
    }

    /**
     * Shallow-merge attributes into this scope. Used by Node's provider when patching live request context via
     * `flare.mergeContext({ ... })`. Last write wins per key; nested objects are not deep-merged.
     */
    mergeAttributes(partial: Attributes): void {
        Object.assign(this.pendingAttributes, partial);
    }
}

/**
 * The seam through which `Flare` reaches its current `Scope`; implementations decide what "current" means.
 * `GlobalScopeProvider` always returns the same instance (browser); `@flareapp/node`'s provider returns the
 * per-request `NodeScope` from `node:async_hooks`, falling back to a shared scope outside any `runWithContext(...)`.
 * Consumers may supply their own.
 */
export interface ScopeProvider {
    active(): Scope;
}

/**
 * One `Scope` for the provider's lifetime, shared by every caller. Right default for single-context environments
 * (browser tab, CLI script) and the fallback `Flare`'s constructor uses when no provider is supplied.
 */
export class GlobalScopeProvider implements ScopeProvider {
    private scope = new Scope();
    active(): Scope {
        return this.scope;
    }
}
