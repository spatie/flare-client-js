import { BreadcrumbBuffer } from './breadcrumbs/BreadcrumbBuffer';
import type { Attributes, AttributeValue, EntryPointHandler, Glow } from './types';

/** `USER_IDENTITY_KEYS` derives from this, so adding a field here can never leave the clear pass stale. */
export const USER_FIELD_KEYS = {
    id: 'user.id',
    email: 'user.email',
    fullName: 'user.full_name',
    ipAddress: 'client.address',
} as const;

/** Every key `Flare.setUser` owns. Consumers stamping identity outside core's report pipeline (Electron's
 *  forwarded-renderer path) reuse this exact set. */
export const USER_IDENTITY_KEYS = [...Object.values(USER_FIELD_KEYS), 'user.attributes'] as const;

/** For reports that do not flow through `Flare.report()`, which would spread `pendingAttributes` itself. */
export function userIdentityAttributes(scope: Scope): Attributes {
    const attrs: Attributes = {};
    for (const key of USER_IDENTITY_KEYS) {
        const value = scope.pendingAttributes[key];
        if (value !== undefined) {
            attrs[key] = value;
        }
    }
    return attrs;
}

/**
 * Per-call mutable state, split out of `Flare` so the consumer can choose one global `Scope` (browser, one
 * user at a time) or one per request via AsyncLocalStorage (Node, where concurrent requests must not leak
 * into each other). `@flareapp/node`'s `NodeScope` extends this with a `request` bucket.
 */
export class Scope {
    /** One buffer per scope: the browser has one for the page session, Node one per request. */
    breadcrumbs = new BreadcrumbBuffer();
    pendingAttributes: Attributes = {};
    entryPoint: EntryPointHandler | null = null;

    /** Read side only. Glows are written through `Flare.glow()`, which goes via the glow recorder. */
    get glows(): readonly Glow[] {
        return this.breadcrumbs.glows();
    }

    setAttribute(key: string, value: AttributeValue): void {
        this.pendingAttributes[key] = value;
    }

    /** Shallow: last write wins per key, nested objects are not deep-merged. */
    mergeAttributes(partial: Attributes): void {
        Object.assign(this.pendingAttributes, partial);
    }
}

/**
 * The seam through which `Flare` reaches its current `Scope`; implementations decide what "current" means.
 * `@flareapp/node`'s returns the per-request `NodeScope` from `node:async_hooks`, falling back to a shared
 * scope outside any `runWithContext(...)`.
 */
export interface ScopeProvider {
    active(): Scope;
}

/** One `Scope` for the provider's lifetime. The right default for a browser tab or a CLI script. */
export class GlobalScopeProvider implements ScopeProvider {
    private scope = new Scope();
    active(): Scope {
        return this.scope;
    }
}
