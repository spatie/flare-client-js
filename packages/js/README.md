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

## Cookie consent and GDPR

The client can run behind a consent tool. When consent is off, it sends nothing: no errors, no logs, no traces. Before consent, it does not even assemble a report, so it reads no cookies.

The switch is one method:

```javascript
flare.setConsent(true); // allow sending
flare.setConsent(false); // stop sending, and drop anything captured earlier
```

Recommended flow: do not call `flare.light(key)` until consent is granted. With no key, nothing sends, so this covers the moment before your consent code runs. Use `setConsent` for withdrawal and re-grant, because once the key is set it is the only clean off switch.

```javascript
import { flare } from '@flareapp/js';

// Cookiebot example. OneTrust exposes OptanonWrapper; the idea is the same.
window.addEventListener('CookiebotOnAccept', () => {
    flare.light('your-project-key'); // first grant: start the client
    flare.setConsent(true); // and allow sending
});

window.addEventListener('CookiebotOnDecline', () => {
    flare.setConsent(false); // withdrawal: stop all sends, drop buffers
});
```

Consent defaults to on, so setups without a consent tool are unchanged. `setConsent(false)` stops data leaving the browser. It does not remove the `fetch` and `XHR` patches that tracing and breadcrumbs install, because those only read in memory and never send on their own. To remove those too, call `flare.configure({ enableTracing: false, enableBreadcrumbs: false })`.

## Logging

Beyond errors, the client can send structured logs. Logs are opt-in: enable them with `enableLogs`, then call any of
the eight syslog levels (`debug`, `info`, `notice`, `warning`, `error`, `critical`, `alert`, `emergency`).

```js
flare.configure({ enableLogs: true });

flare.logger.info('Checkout started', { cartId: cart.id, total: cart.total });
```

Logs are buffered and batched, and flushed when the tab is hidden so buffered logs survive a page unload. The optional
second argument is structured, searchable attributes.

## What happens when someone leaves the page

Logs and spans are batched, so there's usually something unsent when a visitor leaves. The client flushes it when
the tab is hidden or the page closes.

Browsers cap what you can send at that moment: roughly 64KB across every request still in flight. The client stays
under 60KB, and logs and spans share that budget.

Switching tabs is safe. Hiding a tab triggers the same flush, and whatever didn't fit goes out when the visitor
comes back.

If nothing fits, the batch is still sent, as a normal request instead of a keepalive one. That usually lands, but
it can be cancelled if the page closes right then.

You'll only hit the limit on pages that produce a lot of telemetry before the visitor leaves. Log less on those
pages rather than raising the limits.

## Documentation

Full documentation on configuration, hooks, context, breadcrumbs, solution providers, and more is available
at [flareapp.io/docs/javascript/general/installation](https://flareapp.io/docs/javascript/general/installation).

## Deprecations

> `redactFullPath` is now a deprecated alias for `redactUrlQuery`. Both names
> are still exported and continue to work; prefer `redactUrlQuery` in new code.

## License

The MIT License (MIT). Please see [License File](../../LICENSE.md) for more information.
