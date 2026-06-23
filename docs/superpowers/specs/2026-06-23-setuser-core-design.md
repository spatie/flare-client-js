# setUser in core — design

Date: 2026-06-23
Status: approved (pending spec review)

## Problem

The Flare backend identifies a user on a report from flat OTel-style attributes:

| Attribute | Type | Purpose |
| --- | --- | --- |
| `user.id` | string | identity key (`error_occurrences.user_key`) |
| `user.email` | string | display label, preferred (Gravatar) |
| `user.full_name` | string | display label, fallback |
| `user.attributes` | object | additional user metadata, rendered as a JSON blob |

References in the backend (`/Users/driesheyninck/srv/flareapp.io`):

- `app/Domain/Error/Support/RawReport.php:166-186` — `userKey()` reads `user.id`; `userLabel()` reads `user.email` then `user.full_name`. Nothing else.
- `resources/js/app/ignition/components/context/sections/User.tsx` — renders `user.full_name`, `user.email`, `user.id`, and `user.attributes` (as JSON).
- `resources/views/front/docs/protocol/general/resources.md` — protocol doc lists exactly `user.id`, `user.full_name`, `user.email`, `user.attributes`.
- Zero references to `enduser.*` anywhere in `app/` or `database/`.

Current client state:

- `@flareapp/node` has a `setUser({ id, email, username, ipAddress })` that maps to `enduser.id`, `enduser.email`, `enduser.username`, `client.address` (`packages/node/src/context/collectNode.ts:107-111`). The backend does NOT read `enduser.*`, so Node-set users are silently NOT identified. This is a shipped bug.
- `@flareapp/js` (browser) has no `setUser`. The only path is `addContextGroup('user', {...})`, which lands as a legacy `context.user` group and relies on the backend's `MapOldReportFormatAction` to convert it.

## Goal

One `setUser` helper in `@flareapp/core` that emits the keys the backend actually reads, shared by every SDK (browser, node, and the framework wrappers that re-export core). Remove the divergent Node implementation entirely so no duplication remains.

## Design

### 1. `User` type (`packages/core/src/types.ts`)

```ts
export type User = {
    id?: string | number;
    email?: string;
    fullName?: string;
    ipAddress?: string;
    [key: string]: AttributeValue | undefined;
};
```

Typed identity fields steer callers to the correct backend keys. The index signature carries arbitrary user metadata (plan, role, etc.) for Laravel-style richness; those land in `user.attributes`.

### 2. `Flare.setUser` (`packages/core/src/Flare.ts`)

Sugar over the active scope. Writing discrete attribute keys to `scopeProvider.active().pendingAttributes` is already scope-aware: browser has one global scope, Node returns the per-request `NodeScope` from its provider. No new `Scope` field needed.

```ts
setUser(user: User | null): this {
    const scope = this.scopeProvider.active();
    for (const k of ['user.id', 'user.email', 'user.full_name', 'user.attributes', 'client.address']) {
        delete scope.pendingAttributes[k];
    }
    if (!user) return this;

    const { id, email, fullName, ipAddress, ...rest } = user;
    if (id !== undefined) scope.setAttribute('user.id', String(id));
    if (email !== undefined) scope.setAttribute('user.email', email);
    if (fullName !== undefined) scope.setAttribute('user.full_name', fullName);
    if (ipAddress !== undefined) scope.setAttribute('client.address', ipAddress);

    const extras = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
    if (Object.keys(extras).length) scope.setAttribute('user.attributes', extras);

    return this;
}
```

Behavior:

- `setUser(null)` clears all identity keys.
- Re-calling overwrites cleanly (clear-then-set, so removing a field on the second call works).
- `id` is stringified (`user.id` is a string key on the backend).
- `ipAddress` maps to `client.address` (OTel-standard, captured by the backend as an HTTP attribute). Keeps the one piece of Node behavior worth preserving.
- Extra keys bundle into `user.attributes` as a nested object, matching the protocol doc and the `User.tsx` JSON renderer. Not flattened to `user.<key>`.

### 3. Node teardown (`@flareapp/node`)

Delete the divergent path so there is one implementation:

- Remove `setUser` override in `packages/node/src/Flare.ts`.
- Remove `setUser` in `packages/node/src/scope/AsyncLocalStorageScopeProvider.ts`.
- Remove the `user` field from `NodeScope` (`packages/node/src/scope/NodeScope.ts`).
- Remove the `enduser.*` / `client.address` block in `packages/node/src/context/collectNode.ts:107-111`.
- Remove the `User` type in `packages/node/src/types.ts`; re-export `User` from `@flareapp/core` in `packages/node/src/index.ts` so the public type name is unchanged.

Node inherits core `setUser` unchanged. Because the active scope under `runWithContext(...)` is the per-request `NodeScope`, identity stays request-isolated exactly as before — now via shared core code.

Breaking changes (acceptable, Node is 0.x, break freely):

- `username` field gone. Callers use `fullName`, or pass `username` as an extra key (lands in `user.attributes`).
- Emitted keys change `enduser.*` -> `user.*`. This is the fix, not a regression: it makes Node identification actually work.

## Testing

- `packages/core/tests/` — new `setUser` tests:
  - writes `user.id` (stringified), `user.email`, `user.full_name`, `client.address`.
  - extras bundle into `user.attributes`; identity fields excluded from the bag.
  - `setUser(null)` clears every identity key.
  - re-set overwrites and drops fields omitted on the second call.
- `packages/node/tests/` — adjust existing user tests:
  - assert output uses `user.*` / `client.address`, no `enduser.*`.
  - two concurrent `runWithContext` scopes do not leak each other's user.
- e2e — assert a browser report sent after `setUser(...)` carries `user.id` / `user.email` / `user.full_name`.

## Docs

- `@flareapp/js` and `@flareapp/node` READMEs: document `setUser` with the field table.
- Framework wrappers (react/vue/svelte/sveltekit/electron): add an explicit `setUser` example to each README, framed for that framework's `flare` instance. They re-export core `Flare`, so the call is identical; the example just shows where it lives per framework.
- Update `CLAUDE.md` if it references a Node-only user helper.
- Flare docs site (separate `flareapp.io` project): add a **Data collection > Identifying users** page for JS/React/Vue/Svelte. Handoff instructions for that project's agent live in `docs/handoffs/2026-06-23-flare-docs-identifying-users.md`.

## Out of scope

- No backend changes. The backend already reads `user.*`; this change makes the client speak it.
- No support for `enduser.*` on the backend. We move the client to the keys the backend already understands.
- No deprecation shim for the old Node `setUser` signature. Pre-1.0, clean break.
