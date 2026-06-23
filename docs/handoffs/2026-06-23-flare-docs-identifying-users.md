# Handoff: add "Identifying users" docs for the JS SDK

For an agent working in the **flareapp.io** docs project (`/Users/driesheyninck/srv/flareapp.io`).

## Background

The `@flareapp/js` client family (browser JS, React, Vue, Svelte/SvelteKit, Electron, Node) is gaining a
`setUser()` helper, implemented once in `@flareapp/core` and inherited by every SDK. It attaches an
identified user to error reports and traces, the same concept the Laravel SDK documents under
**Data collection > Identifying users**.

The JS docs currently have **no** "Identifying users" page. This task adds one, mirroring the Laravel page
(`resources/views/front/docs/laravel/data-collection/identifying-users.md`).

### What `setUser` emits (the protocol contract)

`setUser` writes flat OTel-style attributes, exactly the keys the backend already reads
(`app/Domain/Error/Support/RawReport.php`, `resources/js/.../context/sections/User.tsx`,
`resources/views/front/docs/protocol/general/resources.md`):

| Attribute key     | Source field        | Notes                                                        |
| ----------------- | ------------------- | ------------------------------------------------------------ |
| `user.id`         | `id`                | stringified                                                  |
| `user.email`      | `email`             | drives the Gravatar + label                                  |
| `user.full_name`  | `fullName`          | label fallback when no email                                 |
| `client.address`  | `ipAddress`         | OTel-standard IP key                                         |
| `user.attributes` | any extra keys      | object, rendered as a JSON blob in the UI                    |

`setUser(null)` clears all of the above. These are the same `user.*` keys the protocol doc already lists, so
no backend or protocol change is needed.

## Task

### 1. New page — JavaScript (canonical, full content)

Create `resources/views/front/docs/javascript/data-collection/identifying-users.md`:

```markdown
---
title: Identifying users
---

When a user is logged in to your application and an error or trace occurs, you can attach information about
that user to the report so you can see who was affected in Flare.

Call `flare.setUser()` once you know who the user is (after login, on app boot, in a route guard, etc.):

```javascript
import { flare } from '@flareapp/js';

flare.setUser({
    id: 123,
    email: 'jane@example.com',
    fullName: 'Jane Doe',
});
```

The following fields are recognised:

| Field       | Attribute sent   | Description                                              |
|-------------|------------------|---------------------------------------------------------|
| `id`        | `user.id`        | The user's unique identifier. Used to group occurrences.|
| `email`     | `user.email`     | Shown as the user's label, with a Gravatar.             |
| `fullName`  | `user.full_name` | Shown as the user's label when no email is present.     |
| `ipAddress` | `client.address` | The user's IP address.                                  |

All fields are optional. Provide whichever you have; `id` is what links occurrences to a single user.

## Sending extra attributes

Any additional keys you pass are collected under `user.attributes` and shown alongside the user in Flare:

```javascript
flare.setUser({
    id: 123,
    email: 'jane@example.com',
    fullName: 'Jane Doe',
    plan: 'pro',
    teamId: 42,
});
```

Here `plan` and `teamId` are sent as `user.attributes`.

## Clearing the user

When the user logs out, clear the attached user by passing `null`:

```javascript
flare.setUser(null);
```

## Per-request scope (Node)

In `@flareapp/node`, `setUser()` attaches the user to the current request scope, so concurrent requests do
not share or leak each other's user. Call it inside your request handler (typically within
`runWithContext(...)`):

```javascript
import { flare } from '@flareapp/node';

flare.setUser({ id: user.id, email: user.email, fullName: user.name });
```
```

(Note: in the code block above, the inner triple-backtick fences are part of the page content. When you save
the real `.md` file, keep them as normal fenced code blocks.)

### 2. New pages — React, Vue, Svelte (thin pointers)

Follow the existing convention used by `adding-custom-context.md` in each framework: a short page that points
to the canonical JavaScript page. The `flare` instance and `setUser` call are identical across frameworks.

Create each of these with the same body, only the `title` stays the same:

- `resources/views/front/docs/react/data-collection/identifying-users.md`
- `resources/views/front/docs/vue/data-collection/identifying-users.md`
- `resources/views/front/docs/svelte/data-collection/identifying-users.md`

```markdown
---
title: Identifying users
---

Head over to the [JavaScript identifying users documentation](/docs/javascript/data-collection/identifying-users)
for full details on `flare.setUser()`. The `flare` instance behaves identically in this framework.
```

### 3. Register the page in the navigation

Edit `app/Support/Documentation/DocumentationNavigation.php`. Add `'Identifying users'` to the
`'Data Collection'` array of the **JavaScript**, **React**, **Vue**, and **Svelte** chapters. Today each looks
like:

```php
'Data Collection' => [
    'Adding custom context',
    'Adding glows',
],
```

Change each to:

```php
'Data Collection' => [
    'Adding custom context',
    'Adding glows',
    'Identifying users',
],
```

Affected sections (line numbers approximate, verify before editing):

- JavaScript — around lines 194-197
- React — around lines 215-218
- Vue — around lines 236-239
- Svelte — around lines 258-261

Do NOT add it to `JavaScriptV1` (the legacy v1 chapter) — v1 has no `setUser`.

The nav builds the URL as `Str::slug(page)`, so `'Identifying users'` resolves to
`.../data-collection/identifying-users`, matching the `identifying-users.md` filename. No other wiring needed.

### 4. Verify

- The four new pages render at:
  - `/docs/javascript/data-collection/identifying-users`
  - `/docs/react/data-collection/identifying-users`
  - `/docs/vue/data-collection/identifying-users`
  - `/docs/svelte/data-collection/identifying-users`
- Each appears in the sidebar under **Data collection**.
- If the docs project has a check for deleted pages needing redirects
  (`DeletedDocumentationPagesMissingRedirects`), confirm adding pages does not trip it (it should not — these
  are additions, not deletions).

## Out of scope

- No protocol changes. The `user.*` / `client.address` / `user.attributes` keys are already documented in
  `resources/views/front/docs/protocol/general/resources.md`.
- No Electron-specific page. Electron renderers use the framework SDKs; the framework pages cover it.
- No backend changes.
