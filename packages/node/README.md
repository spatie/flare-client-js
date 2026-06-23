# @flareapp/node

Node.js SDK for [flareapp.io](https://flareapp.io). Capture uncaught
exceptions, unhandled rejections, explicit `flare.report(err)` calls, and
structured logs in your Node servers. Per-request context isolation via
AsyncLocalStorage.

> **Status: unstable (0.x).** This package is pre-1.0 and its API may change
> between minor releases. Pin an exact version in production
> (`"@flareapp/node": "0.1.0"`). The 2.x packages (`@flareapp/js` and the
> framework integrations) are stable and unaffected.

Requires Node 22 or newer.

## Install

```bash
npm install @flareapp/node
```

## Quick start

```ts
import { flare } from '@flareapp/node';

flare.light('your-flare-api-key');
```

That's it. Crashes and unhandled rejections are reported automatically (the
default behavior is to report, flush, and exit with code 1).

## Logging

Beyond errors, the SDK can send structured logs. Logs are opt-in: enable them
with `enableLogs`, then call any of the eight syslog levels (`debug`, `info`,
`notice`, `warning`, `error`, `critical`, `alert`, `emergency`).

```ts
flare.configure({ enableLogs: true });

flare.logger.info('Order processed', { orderId: order.id, total: order.total });
```

Logs are buffered and batched, and flushed on `beforeExit`. A log recorded
inside a `runWithContext` scope carries that request's context. `beforeExit`
does not fire on `SIGTERM` or `process.exit()`, so call `flare.flush()` during
graceful shutdown to drain buffered logs.

## Per-request context

In an HTTP server, wrap each request handler with `runWithContext` so the
SDK has request data attached to any error reported during that request:

```ts
import http from 'node:http';
import { flare } from '@flareapp/node';

flare.light('your-flare-api-key');

http.createServer((req, res) => {
    flare.runWithContext({ method: req.method, path: req.url, headers: req.headers }, () => {
        // your handler logic
    });
}).listen(3000);
```

When your authentication middleware resolves a user, attach it:

```ts
flare.setUser({ id: user.id, email: user.email, fullName: user.name });
```

Recognised fields: `id`, `email`, `fullName`, `ipAddress`. Extra keys are collected under `user.attributes`. `setUser` is scoped per request inside `runWithContext(...)`. Pass `null` to clear.

You can also patch the request context after it was first set:

```ts
flare.mergeContext({ url: resolvedAbsoluteUrl });
```

## Framework wiring

> **Async errors and request context.** A report only carries request context
> (`http.request.*`, `url.path`, user) when it is created while the request's
> `runWithContext` scope is active. `AsyncLocalStorage` propagates that scope
> across `await`, but a report fired from a framework's _global_ error handler
> only stays in scope if that handler runs inside the request's async chain.
> When in doubt, report inside `runWithContext`. The patterns below are verified
> by `e2e/node-frameworks/context.spec.ts` against the versions noted.

### Express

```ts
import express from 'express';
import { flare } from '@flareapp/node';

flare.light('your-key');

const app = express();
app.use((req, res, next) => {
    flare.runWithContext({ method: req.method, path: req.originalUrl, headers: req.headers }, () => next());
});
// ... your routes
app.use((err, req, res, next) => {
    flare.report(err);
    res.status(500).send('Internal Server Error');
});
```

### Fastify

```ts
import Fastify from 'fastify';
import { flare } from '@flareapp/node';

flare.light('your-key');

const app = Fastify();
app.addHook('onRequest', (req, _reply, done) => {
    flare.runWithContext({ method: req.method, path: req.url, headers: req.headers }, () => done());
});
app.setErrorHandler((err, _req, reply) => {
    flare.report(err);
    reply.status(500).send({ error: 'Internal Server Error' });
});
```

### Hono

```ts
import { Hono } from 'hono';
import { flare } from '@flareapp/node';

flare.light('your-key');

const app = new Hono();
app.use('*', async (c, next) => {
    await flare.runWithContext(
        { method: c.req.method, path: c.req.path, headers: Object.fromEntries(c.req.raw.headers) },
        () => next(),
    );
});
app.onError((err, c) => {
    flare.report(err);
    return c.text('Internal Server Error', 500);
});
```

Verified with Express 5, Fastify 5, Hono 4. Express 4 does not catch async
route errors at all (they surface as `unhandledRejection`); use Express 5 or
report inside `runWithContext`.

## Configuration

```ts
flare.configureNode({
    uncaughtExceptionMode: 'report-and-exit', // 'off' | 'report' | 'report-and-exit'
    unhandledRejectionMode: 'report-and-exit',
    shutdownTimeoutMs: 2000,
    captureRequestBody: false,
    bodyMaxBytes: 16_384,
    headerDenylist: /^x-private-/i, // unioned with the default denylist
    headerAllowlist: undefined,
});
```

## Security: header and body capture defaults

Headers are emitted as `http.request.header.<lowercase-name>`. The default
denylist redacts `authorization`, `cookie`, `set-cookie`, `x-api-key`,
`proxy-authorization`, `x-csrf-token`, `x-xsrf-token`, `x-auth-token`,
`forwarded`, and `x-forwarded-for|user`. Values for denylisted headers are
replaced with `[redacted]`.

Body capture is off by default. When enabled, only `application/json` and
`application/x-www-form-urlencoded` content types are captured. PII keys
(`password`, `token`, `secret`, etc.) are redacted in the captured body. Body
is truncated to 16 KB by default.
