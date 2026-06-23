# @flareapp/js

The core JavaScript/TypeScript client for [Flare](https://flareapp.io) error tracking and logging. Captures frontend
errors, parses stack traces, collects browser context, sends structured logs, and reports everything to the Flare
backend.

## Installation

```bash
npm install @flareapp/js
```

## Quick start

```js
import { flare } from '@flareapp/js';

flare.light('YOUR_FLARE_API_KEY');
```

That is all you need. The client automatically listens for uncaught exceptions and unhandled promise rejections,
collects browser context, and sends error reports to Flare.

## Identifying users

Attach the logged-in user to reports so you can see who was affected:

```javascript
import { flare } from '@flareapp/js';

flare.setUser({
    id: 123,
    email: 'jane@example.com',
    fullName: 'Jane Doe',
});
```

Recognised fields: `id` (→ `user.id`), `email` (→ `user.email`), `fullName` (→ `user.full_name`), `ipAddress` (→ `client.address`). Any extra keys are collected under `user.attributes`. Pass `null` to clear the user on logout: `flare.setUser(null)`.

## Logging

Beyond errors, the client can send structured logs. Logs are opt-in: enable them with `enableLogs`, then call any of
the eight syslog levels (`debug`, `info`, `notice`, `warning`, `error`, `critical`, `alert`, `emergency`).

```js
flare.configure({ enableLogs: true });

flare.logger.info('Checkout started', { cartId: cart.id, total: cart.total });
```

Logs are buffered and batched, and flushed when the tab is hidden so buffered logs survive a page unload. The optional
second argument is structured, searchable attributes.

## Documentation

Full documentation on configuration, hooks, context, breadcrumbs, solution providers, and more is available
at [flareapp.io/docs/javascript/general/installation](https://flareapp.io/docs/javascript/general/installation).

## Deprecations

> `redactFullPath` is now a deprecated alias for `redactUrlQuery`. Both names
> are still exported and continue to work; prefer `redactUrlQuery` in new code.

## License

The MIT License (MIT). Please see [License File](../../LICENSE.md) for more information.
