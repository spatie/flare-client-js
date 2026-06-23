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
- `@flareapp/electron` has the SAME bug. `ElectronFlare` extends `CoreFlare` and OVERRIDES `setUser` (`packages/electron/src/main/ElectronFlare.ts:136`), storing an `ElectronUser` on `this.user`. `projectUser` (`packages/electron/src/main/collectElectron.ts:44-62`) then emits `enduser.id`, `enduser.email`, `enduser.username`, `client.address` from two sites: the main-process context collector (`collectElectron.ts:73`) and the forwarded-renderer overlay (`ElectronFlare.ts:228`). Backend reads none of `enduser.*`, so Electron-set users are silently NOT identified.
- `@flareapp/js` (browser) has no `setUser`. The only path is `addContextGroup('user', {...})`, which lands as a legacy `context.user` group and relies on the backend's `MapOldReportFormatAction` to convert it.

## Goal

One `setUser` helper in `@flareapp/core` that emits the keys the backend actually reads, used by every SDK. The browser SDK and the four framework wrappers (react / vue / svelte / sveltekit) inherit it for free — they re-export core `Flare` and have no `setUser` of their own. Node and Electron each ship a divergent override emitting dead `enduser.*` keys; remove both so there is one implementation and no duplication remains. Electron is NOT a free re-export: it subclasses `CoreFlare` and overrides `setUser`, and its forwarded-renderer path bypasses core's report pipeline, so it needs explicit migration (section 4), not just deletion.

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
// Single source of truth for the report keys setUser owns. The clear pass below
// iterates this; the set pass must write exactly these keys. Keeping it one named
// constant stops the clear list and the set list from drifting apart when a field
// is added or renamed (add a key here, then a matching set line below — never edit
// an inline literal in only one of the two passes).
const USER_IDENTITY_KEYS = ['user.id', 'user.email', 'user.full_name', 'user.attributes', 'client.address'] as const;

setUser(user: User | null): this {
    const scope = this.scopeProvider.active();
    for (const k of USER_IDENTITY_KEYS) delete scope.pendingAttributes[k];
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

Assumption — `client.address` ownership: `setUser` clears and re-writes `client.address` as part of the identity set. Today nothing else writes that key (the only producers are the Node and Electron user paths this change removes), so the clear is safe. If a future request/IP collector starts emitting `client.address` on its own, `setUser` called without `ipAddress` (or `setUser(null)`) would wipe it. Revisit the clear list when that collector lands.

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

### 4. Electron teardown (`@flareapp/electron`)

Electron has the same `enduser.*` bug and is NOT fixed by the core change alone, because `ElectronFlare` overrides `setUser` (its override shadows the inherited core method) and because forwarded renderer reports bypass core's `report()` pipeline that spreads `pendingAttributes`. Both must be migrated by hand.

`ElectronFlare` uses the default `GlobalScopeProvider` (one scope for the main process), so core `setUser` writing to `scopeProvider.active().pendingAttributes` is correct for Electron — same single-scope model as the browser.

Remove the divergence:

- Remove the `setUser` override and the `private user: ElectronUser | null` field in `packages/electron/src/main/ElectronFlare.ts`. Electron inherits core `setUser` (which returns `this`; the old override returned `void`).
- Remove `projectUser` and the `ElectronUser`-typed `getUser` parameter in `packages/electron/src/main/collectElectron.ts`. The main-process collector (`collectElectron.ts:73`) no longer needs to inject user attributes: core `setUser` already wrote `user.*` into the active scope's `pendingAttributes`, and `Flare.report()` spreads those onto every main-origin report.
- Remove the `ElectronUser` type in `packages/electron/src/types.ts`; re-export `User` from `@flareapp/core` and update the `main.ts` export (`packages/electron/src/main.ts:8`) so the public type name stays available. Same break as Node: `username` -> `fullName` or an extra key.

Forwarded-renderer path (the one that does NOT come for free):

- `receiveRendererReport` (`ElectronFlare.ts:228`) currently overlays `projectUser(this.user)` onto each forwarded report so main-process user identity is authoritative for renderer reports too. Forwarded reports skip core's pipeline, so they will NOT pick up `pendingAttributes` automatically. Replace the `projectUser(this.user)` overlay with one that copies the `USER_IDENTITY_KEYS` subset out of the active scope's `pendingAttributes` (i.e. `Object.assign(report.attributes, pickKeys(this.scopeProvider.active().pendingAttributes, USER_IDENTITY_KEYS))`). This preserves the existing "main user is authoritative for renderer reports" guarantee while sourcing identity from the shared core path. Export `USER_IDENTITY_KEYS` from core (or a small `userIdentityAttributes(scope)` helper) so Electron does not re-hardcode the key list and re-introduce drift.
- Renderer-side `setUser` (when a renderer calls Flare directly via the react/vue/svelte `/inject` entries) already routes through core `setUser` and rides the normal renderer report pipeline. No change needed there; the forwarded overlay only governs identity stamped by the MAIN process.

Breaking changes (acceptable, Electron is pre-stable):

- Same as Node: `username` field gone, emitted keys `enduser.*` -> `user.*`. This makes Electron identification actually work.

## Testing

- `packages/core/tests/` — new `setUser` tests:
  - writes `user.id` (stringified), `user.email`, `user.full_name`, `client.address`.
  - extras bundle into `user.attributes`; identity fields excluded from the bag.
  - `setUser(null)` clears every identity key.
  - re-set overwrites and drops fields omitted on the second call.
  - `user.attributes` reaches the sent report as a nested object (not flattened or stringified). Assert against the report the API received, not just `scope.pendingAttributes`, since the object shape has to survive encode/serialize.
- `packages/node/tests/` — adjust existing user tests:
  - assert output uses `user.*` / `client.address`, no `enduser.*`.
  - two concurrent `runWithContext` scopes do not leak each other's user.
- `packages/electron/tests/` — adjust/add user tests:
  - a main-origin report after `setUser(...)` carries `user.*` / `client.address`, no `enduser.*`.
  - a forwarded renderer report is stamped with the main process's `user.*` identity (the `receiveRendererReport` overlay), and main identity wins over any renderer-supplied user key.
  - `ElectronUser` removal does not break the public type export (`User` re-exported from core).
- e2e — assert a browser report sent after `setUser(...)` carries `user.id` / `user.email` / `user.full_name`.

## Docs

- `@flareapp/js` and `@flareapp/node` READMEs: document `setUser` with the field table.
- Framework wrappers (react/vue/svelte/sveltekit): add an explicit `setUser` example to each README, framed for that framework's `flare` instance. They re-export core `Flare`, so the call is identical; the example just shows where it lives per framework.
- `@flareapp/electron` README: document `setUser` once the override is removed (section 4). The signature becomes identical to core after migration, but call this out separately — pre-migration it was an Electron-specific `ElectronUser` shape with a different field set (`username`), so the example must reflect the post-change `User` type, not the old one.
- Update `CLAUDE.md` if it references a Node-only user helper.
- Flare docs site (separate `flareapp.io` project): add a **Data collection > Identifying users** page for JS/React/Vue/Svelte. Handoff instructions for that project's agent live in `docs/handoffs/2026-06-23-flare-docs-identifying-users.md`.

## Out of scope

- No backend changes. The backend already reads `user.*`; this change makes the client speak it.
- No support for `enduser.*` on the backend. We move the client to the keys the backend already understands.
- No deprecation shim for the old Node `setUser` signature. Pre-1.0, clean break.
